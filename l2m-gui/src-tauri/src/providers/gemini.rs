use super::{sanitize_markdown_output, BaseProvider, SYSTEM_PROMPT, get_user_prompt};
use async_trait::async_trait;
use serde_json::json;
use std::time::Duration;

pub struct GeminiProvider {
    api_key: String,
    client: reqwest::Client,
}

impl GeminiProvider {
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
impl BaseProvider for GeminiProvider {
    async fn validate_key(&self) -> Result<bool, String> {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models?key={}",
            self.api_key
        );
        let res = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Verbindungsfehler zu Google Gemini: {}", e))?;

        let status = res.status();
        if status.is_success() {
            Ok(true)
        } else {
            let body = res.text().await.unwrap_or_default();
            Err(format!("Google Gemini API-Fehler ({}): {}", status, body))
        }
    }

    async fn transcribe_slide(
        &self,
        webp_base64: &str,
        page_number: usize,
        is_visual: bool,
        hybrid: bool,
    ) -> Result<(String, String), String> {
        let model = if !hybrid || is_visual {
            "gemini-1.5-pro"
        } else {
            "gemini-2.0-flash"
        };

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            model, self.api_key
        );

        let user_prompt = get_user_prompt(page_number);

        let payload = json!({
            "contents": [
                {
                    "parts": [
                        {
                            "inline_data": {
                                "mime_type": "image/webp",
                                "data": webp_base64
                            }
                        },
                        {
                            "text": user_prompt
                        }
                    ]
                }
            ],
            "system_instruction": {
                "parts": [
                    { "text": SYSTEM_PROMPT }
                ]
            },
            "generationConfig": {
                "temperature": 0.0
            }
        });

        let mut attempts = 0;
        let max_attempts = 6;
        let mut backoff_delay = Duration::from_millis(2500);

        loop {
            attempts += 1;

            let res_result = self
                .client
                .post(&url)
                .json(&payload)
                .send()
                .await;

            match res_result {
                Ok(res) => {
                    let status = res.status();

                    if status.as_u16() == 429 || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                        if attempts >= max_attempts {
                            let err_body = res.text().await.unwrap_or_default();
                            return Err(format!("Google Gemini Rate-Limit: {}", err_body));
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
                        return Err(format!("Google Gemini Inferenz-Fehler ({}): {}", status, err_body));
                    }

                    let json_resp: serde_json::Value = res
                        .json()
                        .await
                        .map_err(|e| format!("JSON-Parsing-Fehler: {}", e))?;

                    let raw_content = json_resp["candidates"][0]["content"]["parts"][0]["text"]
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
