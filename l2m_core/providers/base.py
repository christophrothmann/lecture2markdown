from abc import ABC, abstractmethod

class BaseProvider(ABC):
    def __init__(self, api_key: str):
        self.api_key = api_key

    @abstractmethod
    def transcribe_slide(
        self,
        base64_image: str,
        page_number: int,
        is_visual: bool,
        hybrid: bool = True
    ) -> tuple[str, str]:
        """
        Transcribes a slide image into clean Markdown.
        Returns:
            tuple[str, str]: (markdown_content, model_used_name)
        """
        pass
