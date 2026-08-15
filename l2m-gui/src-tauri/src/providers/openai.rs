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
    if error_msg.contains("tokens per min") || error_msg.contains("TPM") {
        if let Ok(re_sec) = Regex::new(r"try again in ([0-9]+(?:\.[0-9]+)?)s") {
            if let Some(caps) = re_sec.captures(error_msg) {
                if let Some(m) = caps.get(1) {
                    if let Ok(secs) = m.as_str().parse::<f64>() {
                        return Duration::from_millis(((secs + 2.0) * 1000.0) as u64);
                    }
                }
            }
        }
        return Duration::from_millis(3500);
    }

    if let Ok(re_sec) = Regex::new(r"try again in ([0-9]+(?:\.[0-9]+)?)s") {
        if let Some(caps) = re_sec.captures(error_msg) {
            if let Some(m) = caps.get(1) {
                if let Ok(secs) = m.as_str().parse::<f64>() {
                    return Duration::from_millis(((secs + 1.0) * 1000.0) as u64);
                }
            }
        }
    }

    if let Ok(re_ms) = Regex::new(r"try again in ([0-9]+)ms") {
        if let Some(caps) = re_ms.captures(error_msg) {
            if let Some(m) = caps.get(1) {
                if let Ok(ms) = m.as_str().parse::<u64>() {
                    return Duration::from_millis(ms + 1500);
                }
            }
        }
    }

    Duration::from_millis(3000)
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

        let mut attempts = 0;
        let max_attempts = 30;

        loop {
            attempts += 1;

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

                    // If model 404s or is deprecated/inaccessible, fallback to gpt-4o-mini
                    if status == reqwest::StatusCode::NOT_FOUND && model != "gpt-4o-mini" {
                        model = "gpt-4o-mini";
                        tokio::time::sleep(Duration::from_millis(500)).await;
                        continue;
                    }

                    if status.as_u16() == 429 || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                        let err_body = res.text().await.unwrap_or_default();

                        // Fast switch to gpt-4o-mini if gpt-4o is rate-limited
                        if model == "gpt-4o" {
                            model = "gpt-4o-mini";
                            tokio::time::sleep(Duration::from_millis(1000)).await;
                            continue;
                        }

                        if attempts >= max_attempts {
                            return Err(format!("OpenAI Rate-Limit überschritten: {}", err_body));
                        }

                        let wait_duration = parse_retry_duration(&err_body);
                        let jitter = Duration::from_millis((rand::random::<u64>() % 1500) + 500);
                        let total_wait = wait_duration + jitter;

                        tokio::time::sleep(total_wait).await;
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
                    if attempts >= max_attempts {
                        return Err(format!("Netzwerkfehler bei Folie {}: {}", page_number, e));
                    }
                    let jitter = Duration::from_millis((rand::random::<u64>() % 1500) + 1000);
                    tokio::time::sleep(Duration::from_millis(2500) + jitter).await;
                }
            }
        }
    }
}
