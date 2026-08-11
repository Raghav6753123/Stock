# Local Chatbot Model Integration

This project now supports a local fine-tuned chatbot model (LoRA adapter) as an alternative to Gemini.

## Setup Instructions

### 1. Model Files
Place your fine-tuned LoRA adapter files in the following directory:
`Stonks/models/chatbot/stock-chat-qwen3-lora-final/`

Required files:
- `adapter_config.json`
- `adapter_model.safetensors`
- `tokenizer.json`
- `tokenizer_config.json`

### 2. Environment Variables
Update your `.env.local` file with the following:

```env
# Chatbot Provider Config
CHAT_MODEL_PROVIDER=local_finetuned
CHAT_MODEL_FALLBACK_PROVIDER=gemini
CHAT_MODEL_ENABLE_FALLBACK=true

# Local Chat Model Config
LOCAL_CHAT_BASE_MODEL=unsloth/Qwen3-4B-Instruct-2507-unsloth-bnb-4bit
LOCAL_CHAT_ADAPTER_PATH=models/chatbot/stock-chat-qwen3-lora-final
ML_SERVICE_URL=http://localhost:8001
```

### 3. Install Python Dependencies
The local model requires `transformers`, `peft`, `torch`, and `bitsandbytes`.
Navigate to `ml_service` and install them:

```bash
cd ml_service
pip install -r requirements.txt
```

### 4. Running the Local Service
Ensure the `ml_service` is running on port 8001:

```bash
cd ml_service
uvicorn app.main:app --reload --port 8001
```

## Provider Switching
- To use **Local Model**: Set `CHAT_MODEL_PROVIDER=local_finetuned`.
- To use **Gemini**: Set `CHAT_MODEL_PROVIDER=gemini`.
- **Fallback**: If `CHAT_MODEL_ENABLE_FALLBACK=true`, the system will automatically switch to Gemini if the local service fails.

## Maintenance
The chatbot provider setting affects only chatbot responses; core market, news, and portfolio features remain available independently.
