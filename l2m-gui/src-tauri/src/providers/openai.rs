use super::{sanitize_markdown_output, BaseProvider, SYSTEM_PROMPT, get_user_prompt};
use async_trait::async_trait;
use serde_json::json;
use std::time::Duration;

pub struct OpenAIProvider {
    api_key: String,
    client: reqwest::Client,
}

impl OpenAIProvider {
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
impl BaseProvider for OpenAIProvider {
    async fn validate_key(&self) -> Result<bool, String> {
        let res = self
            .client
            .get("https://api.openai.com/v1/models")
            .bearer_auth(&self.api_key)
            .send()
            .await
            .map_err(|e| format!("Verbindungsfehler zu OpenAI: {}", e))?;

        let status = res.status();
        if status.is_success() {
            Ok(true)
        } else {
            let body = res.text().await.unwrap_or_default();
            Err(format!("OpenAI API-Fehler ({}): {}", status, body))
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
            "gpt-4o"
        } else {
            "gpt-4o-mini"
        };

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
            .post("https://api.openai.com/v1/chat/completions")
            .bearer_auth(&self.api_key)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Netzwerkfehler bei Folie {}: {}", page_number, e))?;

        if !res.status().is_success() {
            let err_body = res.text().await.unwrap_or_default();
            return Err(format!("OpenAI Inferenz-Fehler: {}", err_body));
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
