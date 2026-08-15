from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_random_exponential
from ..config import PROVIDER_MODELS, PROVIDER_OPENAI
from ..security import get_system_prompt
from .base import BaseProvider

class OpenAIProvider(BaseProvider):
    def __init__(self, api_key: str):
        super().__init__(api_key)
        self.client = OpenAI(api_key=api_key, max_retries=6)

    def select_model(self, is_visual: bool, hybrid: bool) -> str:
        models = PROVIDER_MODELS[PROVIDER_OPENAI]
        if not hybrid:
            return models["visual"]
        return models["visual"] if is_visual else models["fast"]

    @retry(
        wait=wait_random_exponential(min=1, max=60),
        stop=stop_after_attempt(6),
        retry_error_callback=lambda state: print(f"OpenAI Rate limit. Retrying (Attempt {state.attempt_number})...")
    )
    def _execute_api_call(self, model: str, base64_image: str, page_number: int) -> str:
        user_prompt = (
            f"<slide_metadata>\nSlide Number: {page_number}\n</slide_metadata>\n\n"
            "Task: Transcribe ALL text, bullet points, numbered lists, formulas, and diagrams visible on this lecture slide image into structured Markdown. "
            "Do NOT summarize, condense, or omit any details. Transcribe every learning item verbatim in the slide's language."
        )
        response = self.client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": get_system_prompt()},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{base64_image}"}}
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
