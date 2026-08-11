from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from app.ml.chatbot import get_chatbot_provider

app = FastAPI()


class ChatRequest(BaseModel):
    previous_chat: str
    current_stock_data: str
    current_news_data: str
    retrieved_context: str
    user_question: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/chat")
def chat(req: ChatRequest):
    try:
        provider = get_chatbot_provider()
        answer = provider.generate_answer(
            previous_chat=req.previous_chat,
            current_stock_data=req.current_stock_data,
            current_news_data=req.current_news_data,
            retrieved_context=req.retrieved_context,
            user_question=req.user_question,
        )
        return {"answer": answer}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
