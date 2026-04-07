from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, FileResponse
from pydantic import BaseModel
from dotenv import load_dotenv
from zhipuai import ZhipuAI
import asyncio
import os
import base64
import sys
import uuid
import cv2
import torch
import numpy as np
import torch.nn.functional as F
import datetime

import httpx

# 加载 .env 中的环境变量
load_dotenv()

app = FastAPI()

origins = [
    "http://localhost:5173",
    "http://localhost:8000",
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


# ================= 深度服务配置 =================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEPTH_SERVICE_DIR = os.path.join(BASE_DIR, "backend", "depth_service")
UPLOAD_DIR = os.path.join(DEPTH_SERVICE_DIR, "uploads")
OUTPUT_DIR = os.path.join(DEPTH_SERVICE_DIR, "outputs")

# 添加深度服务的路径
sys.path.insert(0, DEPTH_SERVICE_DIR)

# 检查pixel-perfect-depth目录是否存在
ppd_dir = os.path.join(DEPTH_SERVICE_DIR, "pixel-perfect-depth")
if not os.path.exists(ppd_dir):
    raise FileNotFoundError(f"缺少pixel-perfect-depth目录，请确保深度模型已正确安装到: {ppd_dir}")

# 添加pixel-perfect-depth到路径
sys.path.insert(0, ppd_dir)

# 确保目录存在
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 导入深度服务的模块
try:
    from ppd.models.ppd import PixelPerfectDepth
    from ppd.utils.set_seed import set_seed
except ImportError as e:
    raise ImportError(f"无法导入ppd模块，请确保pixel-perfect-depth目录结构正确: {e}")

#================= 加载深度模型（只加载一次）=================

print("🔥 正在加载 PixelPerfectDepth 模型...")

set_seed(666)

# 检测设备
print("🔍 正在检测设备...")
if torch.cuda.is_available():
    DEVICE = torch.device("cuda")
    print("✅ 检测到 GPU，使用 CUDA 运行模型")
    print(f"   GPU名称: {torch.cuda.get_device_name(0)}")
    print(f"   CUDA版本: {torch.version.cuda}")
elif torch.backends.mps.is_available():
    DEVICE = torch.device("mps")
    print("✅ 检测到 MPS，使用 Apple Silicon GPU 运行模型")
else:
    DEVICE = torch.device("cpu")
    print("⚠️ 未检测到 GPU，使用 CPU 运行模型")
    print("   提示: 安装支持CUDA的PyTorch可以显著提高推理速度") 

semantics_pth = os.path.join(DEPTH_SERVICE_DIR, "pixel-perfect-depth/checkpoints/depth_anything_v2_vitl.pth")
model_pth = os.path.join(DEPTH_SERVICE_DIR, "pixel-perfect-depth/checkpoints/ppd.pth")

print(f"📦 权重路径: {semantics_pth}")
print(f"📦 权重路径: {model_pth}")

# 检查文件是否存在
if not os.path.exists(semantics_pth):
    raise FileNotFoundError(f"缺少权重文件: {semantics_pth}")
if not os.path.exists(model_pth):
    raise FileNotFoundError(f"缺少权重文件: {model_pth}")

print("⏳ 正在初始化模型架构...")
model = PixelPerfectDepth(
    semantics_model="DA2",
    semantics_pth=semantics_pth,
    sampling_steps=4,
)

print("⏳ 正在加载主模型权重 (load_state_dict)...")
try:
    state_dict = torch.load(model_pth, map_location="cpu") # 强制加载到 CPU 内存
    model.load_state_dict(state_dict, strict=False)
    print("✅ 主模型权重加载成功")
except Exception as e:
    print(f"❌ 主模型权重加载失败: {e}")
    raise e

print(f"⏳ 正在将模型移动到设备: {DEVICE}...")
model = model.to(DEVICE).eval()

print("✅ 模型加载完成，服务准备就绪！")

# ================= 深度服务工具函数 =================

def run_depth(image_path: str, out_path: str):
    print(f"🖼️ 正在读取图片: {image_path}")
    image = cv2.imread(image_path)
    if image is None:
        print("❌ 图片读取失败，路径可能错误或格式不支持")
        return

    H, W = image.shape[:2]
    
    # 1. 先进行 RGB 转换
    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    
    # 2. 移除强制缩放，直接使用原图尺寸进行推理
    # 注意：如果原图过大（如 > 2048），显存/内存可能会爆，这里假设用户上传图片在合理范围内
    # 如果需要限制最大尺寸，可以加一个上限判断，而不是固定缩小到 518
    
    # 为了保证 ViT 模型能处理（通常需要 patch size 的倍数，如 14 或 16）
    # 我们将尺寸调整为 14 的倍数
    patch_h = int(H // 14) * 14
    patch_w = int(W // 14) * 14
    
    if patch_h != H or patch_w != W:
        image_resized = cv2.resize(image_rgb, (patch_w, patch_h))
    else:
        image_resized = image_rgb
    
    print(f"📏 原图: {W}x{H} -> 推理尺寸: {image_resized.shape[1]}x{image_resized.shape[0]}")

    try:
        print("🧠 进入模型推理阶段...")
        with torch.no_grad():
            # 3. 直接传入处理后的原分辨率图片
            depth, _ = model.infer_image(image_resized) 
            print("✅ 模型推理返回结果")

            # infer_image 内部会 resize_keep_aspect（约 1024×768 量级），深度图分辨率未必等于
            # 传入的 image_resized，更不等于原图 (H,W)。必须始终插值到原图尺寸，才能与后续
            # gray_image / mask 对齐。
            print("🔄 正在将深度图插值到原图尺寸...")
            depth = F.interpolate(
                depth,
                size=(H, W),
                mode="bilinear",
                align_corners=False,
            )[0, 0]

            print("✅ 尺寸调整完成")

        depth = depth.cpu().numpy()

        # ========= 1. 归一化 (0~1) =========
        depth = (depth - depth.min()) / (depth.max() - depth.min() + 1e-6)
        
        # ========= 2. 非线性对比度增强（针对细节） =========
        # 使用小于 1.0 的指数可以增强暗部细节（低起伏纹理）
        gamma = 0.8
        depth = np.power(depth, gamma)

        # ========= 3. 反转深度图 (浅色=近) =========
        depth = 1.0 - depth

        # ========= 4. 背景剔除 (Background Removal) =========
        # 使用 Otsu's 二值化找到前景/背景阈值
        # 先转为 0-255 uint8 计算阈值
        depth_u8_temp = (depth * 255).astype(np.uint8)
        otsu_thresh, _ = cv2.threshold(depth_u8_temp, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
        # 稍微降低 Otsu 阈值，保留更多主体边缘，避免切太狠
        # 归一化回 0-1
        bg_thresh = (otsu_thresh / 255.0) * 0.5 
        print(f"✂️ 背景剔除阈值: {bg_thresh:.3f} (Otsu: {otsu_thresh})")
        
        # 将硬阈值改为软阈值羽化，减少主体边缘锯齿
        # feather_width 越大，边缘越柔和；保持在小范围内避免丢失细节
        feather_width = 0.03
        alpha = (depth - (bg_thresh - feather_width)) / (2.0 * feather_width + 1e-6)
        alpha = np.clip(alpha, 0.0, 1.0).astype(np.float32)
        # 仅对 alpha 做轻微平滑，避免把主体内部纹理抹掉
        alpha = cv2.GaussianBlur(alpha, (0, 0), 1.2)
        depth = depth * alpha
        
        # 重新归一化前景部分，拉伸对比度
        mask = alpha > 0.05
        if mask.any():
            d_min = depth[mask].min()
            d_max = depth[mask].max()
            depth[mask] = (depth[mask] - d_min) / (d_max - d_min + 1e-6)

        # ========= 5. 纹理细节叠加 (Texture Detail Enhancement) =========
        # 使用多尺度高频 + 局部对比度增强，提升面部五官等细节
        gray_image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        # 确保 gray_image 尺寸与 depth 一致
        gray_image = cv2.resize(gray_image, (W, H))
        gray_image = gray_image.astype(np.float32) / 255.0
        
        # CLAHE 提升局部对比度（在人物面部区域尤其有效）
        gray_u8 = np.clip(gray_image * 255.0, 0, 255).astype(np.uint8)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray_clahe = clahe.apply(gray_u8).astype(np.float32) / 255.0

        # 多尺度高频：同时保留细小纹理与中尺度起伏
        blur_fine = cv2.GaussianBlur(gray_clahe, (0, 0), 1.2)
        blur_mid = cv2.GaussianBlur(gray_clahe, (0, 0), 2.8)
        high_pass_fine = gray_clahe - blur_fine
        high_pass_mid = gray_clahe - blur_mid
        high_pass = 0.65 * high_pass_fine + 0.35 * high_pass_mid

        # 适度提高细节权重，且仅在前景区域生效
        detail_weight = 0.22
        depth[mask] += high_pass[mask] * detail_weight
        depth = np.clip(depth, 0.0, 1.0)

        # ========= 6. Gamma 拉伸 =========
        depth = np.power(depth, 0.6)   

        # ========= 7. 最终输出转换 =========
        depth = (depth * 255.0).astype(np.uint8)

        # ========= 8. 轻微平滑消除噪点与边缘台阶 =========
        depth = cv2.GaussianBlur(depth, (3, 3), 0)

        print(f"💾 正在保存结果到: {out_path}")
        cv2.imwrite(out_path, depth)
        print("🎉 深度图保存成功")
        
    except Exception as e:
        print(f"❌ 推理过程中发生错误: {str(e)}")
        import traceback
        traceback.print_exc()
        raise e

# ================= 深度服务接口 =================

class DepthByUrlRequest(BaseModel):
    image_url: str

@app.post("/depth")
async def generate_depth(file: UploadFile = File(...)):

    print("📥 收到文件:", file.filename)

    suffix = os.path.splitext(file.filename)[-1]

    uid = str(uuid.uuid4())

    input_path = os.path.join(UPLOAD_DIR, uid + suffix)
    output_path = os.path.join(OUTPUT_DIR, uid + ".png")

    # 保存上传文件
    data = await file.read()

    with open(input_path, "wb") as f:
        f.write(data)

    print("💾 已保存:", input_path)

    # 跑模型
    print("🚀 开始推理...")

    # 使用 asyncio.to_thread 将 CPU 密集型的 run_depth 放入线程池运行
    # 防止阻塞 FastAPI 的主事件循环，导致请求挂起不返回
    await asyncio.to_thread(run_depth, input_path, output_path)

    print("✅ 推理完成:", output_path)

    # 返回图片
    with open(output_path, "rb") as f:
        result = f.read()

    return Response(
        content=result,
        media_type="image/png"
    )

@app.post("/depth/by-url")
async def generate_depth_by_url(payload: DepthByUrlRequest):
    print("📥 收到 URL:", payload.image_url)
    uid = str(uuid.uuid4())
    input_path = os.path.join(UPLOAD_DIR, uid + ".png")
    output_path = os.path.join(OUTPUT_DIR, uid + ".png")
    async with httpx.AsyncClient(timeout=60.0) as client_http:
        r = await client_http.get(payload.image_url)
        r.raise_for_status()
        data = r.content
    with open(input_path, "wb") as f:
        f.write(data)
    print("💾 已保存:", input_path)
    print("🚀 开始推理...")
    
    # 同样使用 asyncio.to_thread
    await asyncio.to_thread(run_depth, input_path, output_path)
    
    print("✅ 推理完成:", output_path)
    with open(output_path, "rb") as f:
        result = f.read()
    return Response(content=result, media_type="image/png")

@app.get("/depth/latest")
def get_latest_depth():
    files = sorted(
        os.listdir(OUTPUT_DIR),
        key=lambda x: os.path.getmtime(os.path.join(OUTPUT_DIR, x)),
        reverse=True
    )

    if not files:
        # 如果没有深度图，返回一个 1x1 的黑色占位图，防止前端 404
        black_pixel = np.zeros((1, 1, 3), dtype=np.uint8)
        _, img_encoded = cv2.imencode('.png', black_pixel)
        return Response(content=img_encoded.tobytes(), media_type="image/png")

    path = os.path.join(OUTPUT_DIR, files[0])
    
    # 强制返回二进制流，禁用缓存
    with open(path, "rb") as f:
        img_bytes = f.read()
    
    return Response(
        content=img_bytes,
        media_type="image/png",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        }
    )

@app.get("/history")
def get_history():
    # 读取uploads目录下的所有文件
    upload_files = []
    for file in os.listdir(UPLOAD_DIR):
        if file.endswith(('.png', '.jpg', '.jpeg', '.gif')):
            file_path = os.path.join(UPLOAD_DIR, file)
            mtime = os.path.getmtime(file_path)
            upload_files.append((file, mtime))
    
    # 按时间排序，取最新的5个
    upload_files.sort(key=lambda x: x[1], reverse=True)
    latest_files = upload_files[:5]
    
    # 构建响应
    history = []
    for file, mtime in latest_files:
        # 生成图片URL
        img_url = f"http://localhost:8000/uploads/{file}"
        
        # 找到对应的深度图
        base_name = os.path.splitext(file)[0]
        depth_file = f"{base_name}.png"
        depth_path = os.path.join(OUTPUT_DIR, depth_file)
        
        if os.path.exists(depth_path):
            depth_url = f"http://localhost:8000/outputs/{depth_file}"
        else:
            # 如果没有对应的深度图，使用最新的深度图
            output_files = sorted(
                os.listdir(OUTPUT_DIR),
                key=lambda x: os.path.getmtime(os.path.join(OUTPUT_DIR, x)),
                reverse=True
            )
            if output_files:
                depth_url = f"http://localhost:8000/outputs/{output_files[0]}"
            else:
                depth_url = ""
        
        # 格式化时间戳
        timestamp = datetime.datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M:%S')
        
        history.append({
            "url": img_url,
            "depthUrl": depth_url,
            "timestamp": timestamp
        })
    
    return {"images": history}

@app.get("/uploads/{file}")
def get_uploaded_file(file):
    file_path = os.path.join(UPLOAD_DIR, file)
    if os.path.exists(file_path):
        return FileResponse(file_path)
    else:
        return {"error": "File not found"}

@app.get("/outputs/{file}")
def get_output_file(file):
    file_path = os.path.join(OUTPUT_DIR, file)
    if os.path.exists(file_path):
        return FileResponse(file_path)
    else:
        return {"error": "File not found"}

