from anthropic import Anthropic
from tenacity import retry, stop_after_attempt, wait_random_exponential
from ..config import PROVIDER_MODELS, PROVIDER_ANTHROPIC
from ..security import get_system_prompt
from .base import BaseProvider

class AnthropicProvider(BaseProvider):
    def __init__(self, api_key: str):
        super().__init__(api_key)
        self.client = Anthropic(api_key=api_key)

    def select_model(self, is_visual: bool, hybrid: bool) -> str:
        models = PROVIDER_MODELS[PROVIDER_ANTHROPIC]
        if not hybrid:
            return models["visual"]
        return models["visual"] if is_visual else models["fast"]

    @retry(
        wait=wait_random_exponential(min=1, max=60),
        stop=stop_after_attempt(6),
        retry_error_callback=lambda state: print(f"Anthropic Rate limit. Retrying (Attempt {state.attempt_number})...")
    )
    def _execute_api_call(self, model: str, base64_image: str, page_number: int) -> str:
        user_prompt = f"<slide_metadata>\nSlide Number: {page_number}\n</slide_metadata>\n\nTask: Transcribe the provided slide image into clean Markdown."
        
        response = self.client.messages.create(
            model=model,
            max_tokens=4096,
            temperature=0.0,
            system=get_system_prompt(),
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": base64_image
                            }
                        },
                        {
                            "type": "text",
                            "text": user_prompt
                        }
                    ]
                }
            ]
        )
        content_blocks = [b.text for b in response.content if hasattr(b, "text")]
        content = "\n".join(content_blocks).strip()
        return "*(Kein relevanter Folieninhalt)*" if not content or content.strip().lower() in ["none", "none.", "no content", "n/a"] else content
    def transcribe_slide(self, base64_image: str, page_number: int, is_visual: bool, hybrid: bool = True) -> tuple[str, str]:
        model = self.select_model(is_visual, hybrid)
        markdown = self._execute_api_call(model, base64_image, page_number)
        return markdown, model
