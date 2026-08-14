import base64
from google import genai
from google.genai import types
from tenacity import retry, stop_after_attempt, wait_random_exponential
from ..config import PROVIDER_MODELS, PROVIDER_GOOGLE
from ..security import get_system_prompt
from .base import BaseProvider

class GeminiProvider(BaseProvider):
    def __init__(self, api_key: str):
        super().__init__(api_key)
        self.client = genai.Client(api_key=api_key)

    def select_model(self, is_visual: bool, hybrid: bool) -> str:
        models = PROVIDER_MODELS[PROVIDER_GOOGLE]
        if not hybrid:
            return models["visual"]
        return models["visual"] if is_visual else models["fast"]

    @retry(
        wait=wait_random_exponential(min=1, max=60),
        stop=stop_after_attempt(6),
        retry_error_callback=lambda state: print(f"Google Gemini Rate limit. Retrying (Attempt {state.attempt_number})...")
    )
    def _execute_api_call(self, model: str, base64_image: str, page_number: int) -> str:
        image_bytes = base64.b64decode(base64_image)
        user_prompt = f"<slide_metadata>\nSlide Number: {page_number}\n</slide_metadata>\n\nTask: Transcribe the provided slide image into clean Markdown."
        
        response = self.client.models.generate_content(
            model=model,
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
                user_prompt
            ],
            config=types.GenerateContentConfig(
                system_instruction=get_system_prompt(),
                temperature=0.0
            )
        )
        content = response.text
        return "*(Kein relevanter Folieninhalt)*" if not content or content.strip().lower() in ["none", "none.", "no content", "n/a"] else content.strip()

    def transcribe_slide(self, base64_image: str, page_number: int, is_visual: bool, hybrid: bool = True) -> tuple[str, str]:
        model = self.select_model(is_visual, hybrid)
        markdown = self._execute_api_call(model, base64_image, page_number)
        return markdown, model
