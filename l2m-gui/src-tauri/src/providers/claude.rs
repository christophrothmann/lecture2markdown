use super::{sanitize_markdown_output, BaseProvider, SYSTEM_PROMPT, get_user_prompt};
use async_trait::async_trait;
use regex::Regex;
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

fn parse_claude_retry_duration(error_msg: &str) -> Duration {
    if let Ok(re_sec) = Regex::new(r"try again in ([0-9]+(?:\.[0-9]+)?)s") {
        if let Some(caps) = re_sec.captures(error_msg) {
            if let Some(m) = caps.get(1) {
                if let Ok(secs) = m.as_str().parse::<f64>() {
                    let wait_secs = secs.min(5.0);
                    return Duration::from_millis(((wait_secs + 0.5) * 1000.0) as u64);
                }
            }
        }
    }
    Duration::from_millis(2000)
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
        let mut model = if !hybrid || is_visual {
            "claude-3-7-sonnet-20250219"
        } else {
            "claude-3-5-haiku-20241022"
        };

        let user_prompt = get_user_prompt(page_number);

        let mut attempts = 0;
        let max_attempts = 15;

        loop {
            attempts += 1;

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

            let res_result = self
                .client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", &self.api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&payload)
                .send()
                .await;

            match res_result {
                Ok(res) => {
                    let status = res.status();

                    if !status.is_success() {
                        let err_body = res.text().await.unwrap_or_default();

                        // If model 404s, fallback to haiku
                        if (status == reqwest::StatusCode::NOT_FOUND || status.as_u16() == 400)
                            && (err_body.contains("not_found_error") || err_body.contains("model"))
                            && model != "claude-3-5-haiku-20241022"
                        {
                            model = "claude-3-5-haiku-20241022";
                            tokio::time::sleep(Duration::from_millis(300)).await;
                            continue;
                        }

                        // Handle 429 Rate Limit and 529 Overloaded Server
                        if status.as_u16() == 429 || status.as_u16() == 529 || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                            if model.contains("sonnet") {
                                model = "claude-3-5-haiku-20241022";
                                tokio::time::sleep(Duration::from_millis(500)).await;
                                continue;
                            }

                            if attempts >= max_attempts {
                                return Err(format!("Anthropic Claude Rate-Limit: {}", err_body));
                            }

                            let wait_duration = parse_claude_retry_duration(&err_body);
                            let jitter = Duration::from_millis((rand::random::<u64>() % 800) + 200);
                            tokio::time::sleep(wait_duration + jitter).await;
                            continue;
                        }

                        return Err(format!("Anthropic Claude Inferenz-Fehler ({}): {}", status, err_body));
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
                    return Ok((sanitized, model.to_string()));
                }
                Err(e) => {
                    if attempts >= max_attempts {
                        return Err(format!("Netzwerkfehler bei Folie {}: {}", page_number, e));
                    }
                    let jitter = Duration::from_millis((rand::random::<u64>() % 800) + 500);
                    tokio::time::sleep(Duration::from_millis(1500) + jitter).await;
                }
            }
        }
    }
}
