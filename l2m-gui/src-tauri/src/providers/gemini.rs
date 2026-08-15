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

        let res = self
            .client
            .post(&url)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Netzwerkfehler bei Folie {}: {}", page_number, e))?;

        if !res.status().is_success() {
            let err_body = res.text().await.unwrap_or_default();
            return Err(format!("Google Gemini Inferenz-Fehler: {}", err_body));
        }

        let json_resp: serde_json::Value = res
            .json()
            .await
            .map_err(|e| format!("JSON-Parsing-Fehler: {}", e))?;

        let raw_content = json_resp["candidates"][0]["content"]["parts"][0]["text"]
            .as_str()
            .unwrap_or("*(Kein Inhalt)*");

        let sanitized = sanitize_markdown_output(raw_content);
        Ok((sanitized, model.to_string()))
    }
}
