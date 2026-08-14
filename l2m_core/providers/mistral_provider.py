try:
    from mistralai import Mistral
except ImportError:
    from mistralai.client import Mistral

from tenacity import retry, stop_after_attempt, wait_random_exponential
from ..config import PROVIDER_MODELS, PROVIDER_MISTRAL
from ..security import get_system_prompt
from .base import BaseProvider

class MistralProvider(BaseProvider):
    def __init__(self, api_key: str):
        super().__init__(api_key)
        self.client = Mistral(api_key=api_key)

    def select_model(self, is_visual: bool, hybrid: bool) -> str:
        models = PROVIDER_MODELS[PROVIDER_MISTRAL]
        if not hybrid:
            return models["visual"]
        return models["visual"] if is_visual else models["fast"]

    @retry(
        wait=wait_random_exponential(min=1, max=60),
        stop=stop_after_attempt(6),
        retry_error_callback=lambda state: print(f"Mistral Rate limit. Retrying (Attempt {state.attempt_number})...")
    )
    def _execute_api_call(self, model: str, base64_image: str, page_number: int) -> str:
        user_prompt = f"<slide_metadata>\nSlide Number: {page_number}\n</slide_metadata>\n\nTask: Transcribe the provided slide image into clean Markdown."
        
        # If model is mistral-ocr-latest and OCR endpoint is available
        if model == "mistral-ocr-latest" and hasattr(self.client, "ocr"):
            try:
                ocr_response = self.client.ocr.process(
                    model="mistral-ocr-latest",
                    document={
                        "type": "image_url",
                        "image_url": f"data:image/png;base64,{base64_image}"
                    }
                )
                if hasattr(ocr_response, "pages") and ocr_response.pages:
                    return ocr_response.pages[0].markdown.strip()
            except Exception:
                pass

        # Standard Multimodal Chat Completion (Pixtral / Mistral Large)
        chat_model = "pixtral-large-latest" if model == "mistral-ocr-latest" else model
        response = self.client.chat.complete(
            model=chat_model,
            messages=[
                {"role": "system", "content": get_system_prompt()},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_prompt},
                        {"type": "image_url", "image_url": f"data:image/png;base64,{base64_image}"}
                    ]
                }
            ],
            temperature=0.0
        )
        content = response.choices[0].message.content
        return "*(Kein relevanter Folieninhalt)*" if not content or content.strip().lower() in ["none", "none.", "no content", "n/a"] else content.strip()

    def transcribe_slide(self, base64_image: str, page_number: int, is_visual: bool, hybrid: bool = True) -> tuple[str, str]:
        model = self.select_model(is_visual, hybrid)
        markdown = self._execute_api_call(model, base64_image, page_number)
        return markdown, model
