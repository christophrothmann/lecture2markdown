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
            .timeout(Duration::from_secs(90))
            .build()
            .unwrap_or_default();
        Self {
            api_key: api_key.to_string(),
            client,
        }
    }
}

fn parse_retry_duration(error_msg: &str, default_delay: Duration) -> Duration {
    // Look for patterns like "Please try again in 2.872s" or "in 124ms"
    if let Ok(re_sec) = Regex::new(r"try again in ([0-9]+(?:\.[0-9]+)?)s") {
        if let Some(caps) = re_sec.captures(error_msg) {
            if let Some(m) = caps.get(1) {
                if let Ok(secs) = m.as_str().parse::<f64>() {
                    return Duration::from_millis(((secs + 0.5) * 1000.0) as u64);
                }
            }
        }
    }
    if let Ok(re_ms) = Regex::new(r"try again in ([0-9]+)ms") {
        if let Some(caps) = re_ms.captures(error_msg) {
            if let Some(m) = caps.get(1) {
                if let Ok(ms) = m.as_str().parse::<u64>() {
                    return Duration::from_millis(ms + 600);
                }
            }
        }
    }
    default_delay
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
        let max_attempts = 10;
        let mut backoff_delay = Duration::from_millis(2000);

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

                    if status.as_u16() == 429 || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                        let err_body = res.text().await.unwrap_or_default();

                        // If gpt-4o hits strict TPM limits (e.g. 30k TPM in Tier 1), fallback to gpt-4o-mini (2M TPM) after 2 attempts
                        if model == "gpt-4o" && attempts >= 2 {
                            model = "gpt-4o-mini";
                            tokio::time::sleep(Duration::from_millis(800)).await;
                            continue;
                        }

                        if attempts >= max_attempts {
                            return Err(format!("OpenAI Rate-Limit überschritten: {}", err_body));
                        }

                        let wait_duration = parse_retry_duration(&err_body, backoff_delay);
                        // Add jitter to prevent thundering herd
                        let jitter = Duration::from_millis((rand::random::<u64>() % 1000) + 300);
                        tokio::time::sleep(wait_duration + jitter).await;

                        backoff_delay = Duration::from_millis((backoff_delay.as_millis() as f64 * 1.5) as u64);
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
                    tokio::time::sleep(backoff_delay).await;
                    backoff_delay = Duration::from_millis((backoff_delay.as_millis() as f64 * 1.5) as u64);
                }
            }
        }
    }
}
