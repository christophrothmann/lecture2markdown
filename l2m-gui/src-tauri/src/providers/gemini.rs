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
            .timeout(Duration::from_secs(90))
            .build()
            .unwrap_or_default();
        Self {
            api_key: api_key.to_string(),
            client,
        }
    }
}

fn parse_gemini_retry_duration(
    retry_after: Option<&str>,
    error_msg: &str,
    attempt: u32,
) -> Duration {
    if let Some(seconds) = retry_after.and_then(|value| value.parse::<f64>().ok()) {
        if seconds.is_finite() && seconds >= 0.0 {
            return Duration::from_secs_f64(seconds.min(45.0));
        }
    }

    if let Ok(re_sec) = Regex::new(r"retry in ([0-9]+(?:\.[0-9]+)?)s") {
        if let Some(seconds) = re_sec
            .captures(error_msg)
            .and_then(|caps| caps.get(1))
            .and_then(|value| value.as_str().parse::<f64>().ok())
        {
            if seconds.is_finite() && seconds >= 0.0 {
                return Duration::from_secs_f64(seconds.min(45.0));
            }
        }
    }

    Duration::from_secs(2_u64.saturating_pow(attempt.saturating_sub(1)).min(45))
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
        _is_visual: bool,
        _hybrid: bool,
    ) -> Result<(String, String), String> {
        let model = "gemini-flash-latest";
        let user_prompt = get_user_prompt(page_number);

        let clean_base64 = if let Some(idx) = webp_base64.find(',') {
            &webp_base64[idx + 1..]
        } else {
            webp_base64
        };

        let mut attempts = 0;
        let max_attempts = 20;

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
                                    "mime_type": super::detect_mime_type(clean_base64),
                                    "data": clean_base64
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

                    if status == reqwest::StatusCode::TOO_MANY_REQUESTS
                        || status == reqwest::StatusCode::SERVICE_UNAVAILABLE
                    {
                        let retry_after = res
                            .headers()
                            .get(reqwest::header::RETRY_AFTER)
                            .and_then(|value| value.to_str().ok())
                            .map(str::to_owned);
                        let err_body = res.text().await.unwrap_or_default();

                        if attempts >= max_attempts {
                            return Err(format!("Google Gemini Rate-Limit: {}", err_body));
                        }

                        let wait_duration =
                            parse_gemini_retry_duration(retry_after.as_deref(), &err_body, attempts);
                        let jitter = Duration::from_millis((rand::random::<u64>() % 1000) + 500);
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
                    let jitter = Duration::from_millis((rand::random::<u64>() % 1000) + 500);
                    let backoff = Duration::from_secs(2_u64.saturating_pow(attempts - 1).min(45));
                    tokio::time::sleep(backoff + jitter).await;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::parse_gemini_retry_duration;
    use std::time::Duration;

    #[test]
    fn retry_after_header_takes_precedence() {
        assert_eq!(
            parse_gemini_retry_duration(Some("3"), "retry in 10s", 1),
            Duration::from_secs(3)
        );
    }

    #[test]
    fn retry_duration_uses_gemini_message_or_exponential_fallback() {
        assert_eq!(
            parse_gemini_retry_duration(None, "please retry in 2.5s", 4),
            Duration::from_millis(2500)
        );
        assert_eq!(
            parse_gemini_retry_duration(None, "rate limited", 3),
            Duration::from_secs(4)
        );
        assert_eq!(
            parse_gemini_retry_duration(Some("999"), "rate limited", 3),
            Duration::from_secs(45)
        );
    }
}
