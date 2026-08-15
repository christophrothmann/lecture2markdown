use super::{sanitize_markdown_output, BaseProvider, SYSTEM_PROMPT, get_user_prompt};
use async_trait::async_trait;
use regex::Regex;
use serde_json::json;
use std::time::Duration;

pub struct GeminiProvider {
    api_key: String,
    client: reqwest::Client,
}

impl GeminiProvider {
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

fn parse_gemini_retry_duration(error_msg: &str) -> Duration {
    if error_msg.contains("RESOURCE_EXHAUSTED") || error_msg.contains("quota") || error_msg.contains("TPM") {
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
    Duration::from_millis(3000)
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
        let mut model = if !hybrid || is_visual {
            "gemini-1.5-pro"
        } else {
            "gemini-2.0-flash"
        };

        let user_prompt = get_user_prompt(page_number);

        let mut attempts = 0;
        let max_attempts = 30; // 30 resilient retries

        loop {
            attempts += 1;

            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                model, self.api_key
            );

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

            let res_result = self
                .client
                .post(&url)
                .json(&payload)
                .send()
                .await;

            match res_result {
                Ok(res) => {
                    let status = res.status();

                    // Handle 429 Rate Limits / Quotas / Overload
                    if status.as_u16() == 429 || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                        let err_body = res.text().await.unwrap_or_default();

                        // Fallback from 1.5-pro to fast 2.0-flash on rate limits
                        if model == "gemini-1.5-pro" {
                            model = "gemini-2.0-flash";
                            tokio::time::sleep(Duration::from_millis(800)).await;
                            continue;
                        }

                        if attempts >= max_attempts {
                            return Err(format!("Google Gemini Rate-Limit: {}", err_body));
                        }

                        let wait_duration = parse_gemini_retry_duration(&err_body);
                        let jitter = Duration::from_millis((rand::random::<u64>() % 1500) + 500);
                        tokio::time::sleep(wait_duration + jitter).await;
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
                    let jitter = Duration::from_millis((rand::random::<u64>() % 1500) + 1000);
                    tokio::time::sleep(Duration::from_millis(2500) + jitter).await;
                }
            }
        }
    }
}
