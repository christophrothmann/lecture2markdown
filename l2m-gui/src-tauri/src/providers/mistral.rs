use super::{sanitize_markdown_output, BaseProvider, SYSTEM_PROMPT, get_user_prompt};
use async_trait::async_trait;
use serde_json::json;
use std::time::Duration;

pub struct MistralProvider {
    api_key: String,
    client: reqwest::Client,
}

impl MistralProvider {
    pub fn new(api_key: &str) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(90))
            .build()
            .unwrap_or_default();
        Self {
            api_key: api_key.to_string(),
            client,
        }
    }
}

#[async_trait]
impl BaseProvider for MistralProvider {
    async fn validate_key(&self) -> Result<bool, String> {
        let res = self
            .client
            .get("https://api.mistral.ai/v1/models")
            .bearer_auth(&self.api_key)
            .send()
            .await
            .map_err(|e| format!("Verbindungsfehler zu Mistral AI: {}", e))?;

        let status = res.status();
        if status.is_success() {
            Ok(true)
        } else {
            let body = res.text().await.unwrap_or_default();
            Err(format!("Mistral AI API-Fehler ({}): {}", status, body))
        }
    }

    async fn transcribe_slide(
        &self,
        webp_base64: &str,
        page_number: usize,
        is_visual: bool,
        hybrid: bool,
    ) -> Result<(String, String), String> {
        let mut attempts = 0;
        let max_attempts = 6;
        let mut backoff_delay = Duration::from_millis(2500);

        // 1. Try dedicated Mistral Document OCR endpoint if visual
        if !hybrid || is_visual {
            let ocr_payload = json!({
                "model": "mistral-ocr-latest",
                "document": {
                    "type": "image_url",
                    "image_url": format!("data:image/webp;base64,{}", webp_base64)
                }
            });

            if let Ok(res) = self
                .client
                .post("https://api.mistral.ai/v1/ocr")
                .bearer_auth(&self.api_key)
                .json(&ocr_payload)
                .send()
                .await
            {
                if res.status().is_success() {
                    if let Ok(json_resp) = res.json::<serde_json::Value>().await {
                        if let Some(pages) = json_resp["pages"].as_array() {
                            if let Some(first_page) = pages.first() {
                                if let Some(markdown) = first_page["markdown"].as_str() {
                                    return Ok((
                                        sanitize_markdown_output(markdown),
                                        "mistral-ocr-latest".to_string(),
                                    ));
                                }
                            }
                        }
                    }
                }
            }
        }

        // 2. Standard Multimodal Chat Completion (Pixtral 12B) with exponential backoff
        let model = "pixtral-12b-2409";
        let user_prompt = get_user_prompt(page_number);
        let image_url = format!("data:image/webp;base64,{}", webp_base64);

        let payload = json!({
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": SYSTEM_PROMPT
                },
                {
                    "role": "user",
                    "content": [
                        { "type": "text", "text": user_prompt },
                        { "type": "image_url", "image_url": { "url": image_url } }
                    ]
                }
            ],
            "temperature": 0.0
        });

        loop {
            attempts += 1;

            let res_result = self
                .client
                .post("https://api.mistral.ai/v1/chat/completions")
                .bearer_auth(&self.api_key)
                .json(&payload)
                .send()
                .await;

            match res_result {
                Ok(res) => {
                    let status = res.status();

                    if status.as_u16() == 429 || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                        if attempts >= max_attempts {
                            let err_body = res.text().await.unwrap_or_default();
                            return Err(format!("Mistral Rate-Limit: {}", err_body));
                        }

                        let sleep_duration = if let Some(retry_header) = res.headers().get("retry-after") {
                            if let Ok(retry_str) = retry_header.to_str() {
                                retry_str.parse::<f64>().map(|s| Duration::from_millis((s * 1000.0) as u64)).unwrap_or(backoff_delay)
                            } else {
                                backoff_delay
                            }
                        } else {
                            backoff_delay
                        };

                        tokio::time::sleep(sleep_duration).await;
                        backoff_delay = Duration::from_millis((backoff_delay.as_millis() as f64 * 1.8) as u64);
                        continue;
                    }

                    if !status.is_success() {
                        let err_body = res.text().await.unwrap_or_default();
                        return Err(format!("Mistral Inferenz-Fehler ({}): {}", status, err_body));
                    }

                    let json_resp: serde_json::Value = res
                        .json()
                        .await
                        .map_err(|e| format!("JSON-Parsing-Fehler: {}", e))?;

                    let raw_content = json_resp["choices"][0]["message"]["content"]
                        .as_str()
                        .unwrap_or("*(Kein Inhalt)*");

                    let sanitized = sanitize_markdown_output(raw_content);
                    return Ok((sanitized, model.to_string()));
                }
                Err(e) => {
                    if attempts >= max_attempts {
                        return Err(format!("Netzwerkfehler bei Folie {}: {}", page_number, e));
                    }
                    tokio::time::sleep(backoff_delay).await;
                    backoff_delay = Duration::from_millis((backoff_delay.as_millis() as f64 * 1.8) as u64);
                }
            }
        }
    }
}
