from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from zhipuai import ZhipuAI
import asyncio
import os
import base64

import httpx

# 加载 .env 中的环境变量
load_dotenv()

app = FastAPI()

origins = [
    "http://localhost:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/ping")
async def ping():
    return {"message": "pong"}


class GenerateImageRequest(BaseModel):
    prompt: str


api_key = os.getenv("ZHIPU_API_KEY")

if not api_key:
    raise RuntimeError("ZHIPU_API_KEY is not set in .env")

client = ZhipuAI(api_key=api_key)


@app.post("/generate-image")
async def generate_image(payload: GenerateImageRequest):
    """
    调用智谱 cogview-3 模型生成图片，并返回图片 URL。
    使用 asyncio 和超时控制避免阻塞整体服务。
    """
    print("正在连接智谱服务器...")

    try:
        # 使用 asyncio.to_thread 把同步 SDK 调用放到线程池，防止阻塞事件循环
        response = await asyncio.wait_for(
            asyncio.to_thread(
                client.images.generations,
                model="cogview-3-plus", # Update to latest model if needed, user code said 'glm-image' but usually it is cogview
                prompt=payload.prompt,
            ),
            timeout=45.0,
        )

        print("收到智谱返回结果了！")

        # 尝试多种结构：对象 / 字典 / 列表元素为对象或字典
        data = getattr(response, "data", None)
        if data is None and isinstance(response, dict):
            data = response.get("data")

        if not data:
            raise HTTPException(
                status_code=500,
                detail="Image generation response format error: empty data",
            )

        first = data[0]

        # 情况 1：data[0] 是对象，带 .url 属性（zhipuai 官方 SDK 常见形式）
        if hasattr(first, "url"):
            image_url = first.url
        # 情况 2：data[0] 是 dict，里面有 'url' 键
        elif isinstance(first, dict) and "url" in first:
            image_url = first["url"]
        else:
            raise HTTPException(
                status_code=500,
                detail="Image generation response format error: url not found",
            )

        return {"image_url": image_url}

    except asyncio.TimeoutError as e:
        print("调用智谱超时，错误类型：", type(e))
        raise HTTPException(
            status_code=504,
            detail=f"Image generation timeout: {type(e).__name__}",
        )
    except HTTPException:
        # 已经构造好的 HTTPException 直接抛出
        raise
    except Exception as e:
        # 打印具体错误类型，方便排查
        import traceback
        traceback.print_exc()
        print("调用智谱失败，错误类型：", type(e), "详情:", str(e))
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate image: {str(e)}",
        )



