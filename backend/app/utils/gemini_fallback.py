import logging
from typing import Any
from google import genai
from app.config import get_settings

logger = logging.getLogger(__name__)

# List of models to try in order, exactly as requested by the user:
GEMINI_MODELS = [
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3-flash-preview",
    "gemini-3.1-pro-preview",
    "gemini-pro-latest",
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemma-4-26b-a4b-it",
    "gemma-4-31b-it",
]

def get_gemini_client() -> genai.Client:
    settings = get_settings()
    return genai.Client(api_key=settings.GEMINI_API_KEY)

def generate_content_with_fallback(
    contents: str | list[Any],
    config: dict[str, Any] | None = None,
) -> Any:
    """
    Call generate_content with a fallback model sequence.
    If the first model fails (e.g. Unsupported model, API error, rate limits),
    it will try the subsequent models in GEMINI_MODELS.
    """
    client = get_gemini_client()
    last_error = None
    
    for model in GEMINI_MODELS:
        try:
            logger.info("Attempting generate_content with model: %s", model)
            response = client.models.generate_content(
                model=model,
                contents=contents,
                config=config,
            )
            logger.info("Successfully generated content using model: %s", model)
            return response
        except Exception as e:
            logger.warning("Model %s failed with error: %s. Falling back to next...", model, e)
            last_error = e
            continue
            
    # If all models fail, raise the last encountered error
    logger.error("All Gemini models failed. Last error: %s", last_error)
    if last_error:
        raise last_error
    else:
        raise Exception("All Gemini models failed with unknown error.")
