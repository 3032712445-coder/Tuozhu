from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from zhipuai import ZhipuAI
import asyncio
import os
import base64

import httpx
import cv2
import numpy as np


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
                model="glm-image",
                prompt=payload.prompt,
                quality="standard",
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
        print("调用智谱失败，错误类型：", type(e))
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate image: {type(e).__name__}",
        )


class GenerateDepthRequest(BaseModel):
    image_url: str


def _encode_depth_to_data_url(depth_uint8: np.ndarray) -> str:
    """将单通道 8bit 深度图编码为 PNG data URL。"""
    success, png_bytes = cv2.imencode(".png", depth_uint8)
    if not success:
        raise RuntimeError("Failed to encode depth map as PNG.")
    b64_data = base64.b64encode(png_bytes.tobytes()).decode("ascii")
    return f"data:image/png;base64,{b64_data}"


def _placeholder_depth_map(width: int = 256, height: int = 256) -> str:
    """
    生成一个默认的灰度占位深度图（中心亮、边缘暗的径向渐变），
    保证在下载/处理出错时 Demo 仍然能展示 3D 浮雕效果。
    """
    print("[generate-depth] 使用占位深度图作为回退。")
    x = np.linspace(-1.0, 1.0, width)
    y = np.linspace(-1.0, 1.0, height)
    xx, yy = np.meshgrid(x, y)
    rr = np.sqrt(xx ** 2 + yy ** 2)
    rr = np.clip(rr, 0.0, 1.0)
    depth_norm = 1.0 - rr  # 中心高、边缘低
    depth_uint8 = (depth_norm * 255.0).astype("uint8")
    return _encode_depth_to_data_url(depth_uint8)


@app.post("/generate-depth")
async def generate_depth(payload: GenerateDepthRequest):
    """
    使用基于 OpenCV 的灰度+归一化方案，将彩色图近似转换为“深度图”。
    不依赖本地深度学习框架，方便在云端轻量部署。
    返回一个 data URL 形式的 depth_map_url，可直接在前端作为纹理使用。
    """
    print(f"[generate-depth] 收到待处理图片：{payload.image_url}")

    try:
        async with httpx.AsyncClient(timeout=60.0) as client_http:
            # 先从给定的 URL 下载源图片
            print("[generate-depth] 正在下载源图片...")
            img_resp = await client_http.get(payload.image_url)
            img_resp.raise_for_status()

        img_bytes = img_resp.content

        # 将下载的图片字节解码为 OpenCV 图像（BGR）
        img_array = np.frombuffer(img_bytes, np.uint8)
        img_bgr = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        if img_bgr is None:
            raise ValueError("无法从提供的 image_url 解码图片。")

        # 简单“深度”近似：转灰度 + 增强对比度 + 轻微模糊，得到平滑的凹凸纹理
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)

        # 自适应直方图均衡，增强明暗层次
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray_eq = clahe.apply(gray)

        # 轻微高斯模糊，避免噪点在 3D 浮雕上放大
        depth_uint8 = cv2.GaussianBlur(gray_eq, (5, 5), 0)

        depth_data_url = _encode_depth_to_data_url(depth_uint8)

        print("[generate-depth] 深度图生成成功（OpenCV 灰度近似）。")
        return {"depth_map_url": depth_data_url}

    except Exception as e:
        print("[generate-depth] 生成深度图失败，使用占位深度图回退。错误类型：", type(e), "详情：", str(e))
        # 返回占位深度图，而不是直接中断 Demo
        placeholder = _placeholder_depth_map()
        return {"depth_map_url": placeholder}


