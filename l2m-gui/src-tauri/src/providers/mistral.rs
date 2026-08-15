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
            .timeout(Duration::from_secs(60))
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
        // First try dedicated Mistral Document OCR endpoint if visual
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

        // Standard Multimodal Chat Completion (Pixtral 12B)
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

        let res = self
            .client
            .post("https://api.mistral.ai/v1/chat/completions")
            .bearer_auth(&self.api_key)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Netzwerkfehler bei Folie {}: {}", page_number, e))?;

        if !res.status().is_success() {
            let err_body = res.text().await.unwrap_or_default();
            return Err(format!("Mistral Inferenz-Fehler: {}", err_body));
        }

        let json_resp: serde_json::Value = res
            .json()
            .await
            .map_err(|e| format!("JSON-Parsing-Fehler: {}", e))?;

        let raw_content = json_resp["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("*(Kein Inhalt)*");

        let sanitized = sanitize_markdown_output(raw_content);
        Ok((sanitized, model.to_string()))
    }
}
