use super::{sanitize_markdown_output, BaseProvider, SYSTEM_PROMPT, get_user_prompt};
use async_trait::async_trait;
use serde_json::json;
use std::time::Duration;

pub struct ClaudeProvider {
    api_key: String,
    client: reqwest::Client,
}

impl ClaudeProvider {
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
impl BaseProvider for ClaudeProvider {
    async fn validate_key(&self) -> Result<bool, String> {
        let res = self
            .client
            .get("https://api.anthropic.com/v1/models")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .send()
            .await
            .map_err(|e| format!("Verbindungsfehler zu Anthropic Claude: {}", e))?;

        let status = res.status();
        if status.is_success() {
            Ok(true)
        } else {
            let body = res.text().await.unwrap_or_default();
            Err(format!("Anthropic Claude API-Fehler ({}): {}", status, body))
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
            "claude-3-7-sonnet-20250219"
        } else {
            "claude-3-5-haiku-20241022"
        };

        let user_prompt = get_user_prompt(page_number);

        let payload = json!({
            "model": model,
            "max_tokens": 4096,
            "temperature": 0.0,
            "system": SYSTEM_PROMPT,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/webp",
                                "data": webp_base64
                            }
                        },
                        {
                            "type": "text",
                            "text": user_prompt
                        }
                    ]
                }
            ]
        });

        let res = self
            .client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Netzwerkfehler bei Folie {}: {}", page_number, e))?;

        if !res.status().is_success() {
            let err_body = res.text().await.unwrap_or_default();
            return Err(format!("Anthropic Claude Inferenz-Fehler: {}", err_body));
        }

        let json_resp: serde_json::Value = res
            .json()
            .await
            .map_err(|e| format!("JSON-Parsing-Fehler: {}", e))?;

        let mut output_text = String::new();
        if let Some(content_array) = json_resp["content"].as_array() {
            for block in content_array {
                if block["type"] == "text" {
                    if let Some(txt) = block["text"].as_str() {
                        output_text.push_str(txt);
                    }
                }
            }
        }

        let sanitized = sanitize_markdown_output(&output_text);
        Ok((sanitized, model.to_string()))
    }
}
