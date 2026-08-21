use super::{sanitize_markdown_output, BaseProvider, SYSTEM_PROMPT, get_user_prompt};
use async_trait::async_trait;
use regex::Regex;
use serde_json::json;
use std::time::Duration;

pub struct OpenAIProvider {
    api_key: String,
    client: reqwest::Client,
}

impl OpenAIProvider {
    pub fn new(api_key: &str) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .unwrap_or_default();
        Self {
            api_key: api_key.to_string(),
            client,
        }
    }
}

fn parse_retry_duration(error_msg: &str) -> Duration {
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

    if let Ok(re_ms) = Regex::new(r"try again in ([0-9]+)ms") {
        if let Some(caps) = re_ms.captures(error_msg) {
            if let Some(m) = caps.get(1) {
                if let Ok(ms) = m.as_str().parse::<u64>() {
                    return Duration::from_millis((ms + 500).min(4000));
                }
            }
        }
    }

    Duration::from_millis(2000)
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
        let mut model = if !hybrid || is_visual {
            "gpt-4o"
        } else {
            "gpt-4o-mini"
        };

        let user_prompt = get_user_prompt(page_number);
        let image_url = format!("data:image/webp;base64,{}", webp_base64);
        let mut detail_level = if is_visual { "high" } else { "low" };

        let mut attempts = 0;
        let max_attempts = 15;

        loop {
            attempts += 1;

            let payload = json!({
                "model": model,
                "max_completion_tokens": 3000,
                "messages": [
                    {
                        "role": "system",
                        "content": SYSTEM_PROMPT
                    },
                    {
                        "role": "user",
                        "content": [
                            { "type": "text", "text": user_prompt },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": image_url,
                                    "detail": detail_level
                                }
                            }
                        ]
                    }
                ],
                "temperature": 0.0
            });

            let res_result = self
                .client
                .post("https://api.openai.com/v1/chat/completions")
                .bearer_auth(&self.api_key)
                .json(&payload)
                .send()
                .await;

            match res_result {
                Ok(res) => {
                    let status = res.status();

                    // If model 404s, fallback immediately
                    if status == reqwest::StatusCode::NOT_FOUND && model != "gpt-4o-mini" {
                        model = "gpt-4o-mini";
                        detail_level = "low";
                        tokio::time::sleep(Duration::from_millis(300)).await;
                        continue;
                    }

                    if status.as_u16() == 429 || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                        let err_body = res.text().await.unwrap_or_default();

                        // Immediate fast fallback to gpt-4o-mini on rate-limit
                        if model == "gpt-4o" {
                            model = "gpt-4o-mini";
                            detail_level = "low";
                            tokio::time::sleep(Duration::from_millis(500)).await;
                            continue;
                        }

                        if attempts >= max_attempts {
                            return Err(format!("OpenAI Rate-Limit: {}", err_body));
                        }

                        let wait_duration = parse_retry_duration(&err_body);
                        let jitter = Duration::from_millis((rand::random::<u64>() % 800) + 200);
                        tokio::time::sleep(wait_duration + jitter).await;
                        continue;
                    }

                    if !status.is_success() {
                        let err_body = res.text().await.unwrap_or_default();
                        return Err(format!("OpenAI Inferenz-Fehler ({}): {}", status, err_body));
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
                    // If high-detail request times out, gracefully switch to fast mini
                    if model == "gpt-4o" {
                        model = "gpt-4o-mini";
                        detail_level = "low";
                    }

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
