import sys
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

PPD_DIR = os.path.join(BASE_DIR, "pixel-perfect-depth")

sys.path.insert(0, PPD_DIR)

import os
import uuid
import cv2
import torch
import numpy as np
import torch.nn.functional as F
import matplotlib

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
import httpx

from ppd.models.ppd import PixelPerfectDepth
from ppd.utils.set_seed import set_seed
from fastapi.responses import FileResponse

# ================= 基础 =================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
OUTPUT_DIR = os.path.join(BASE_DIR, "outputs")

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)


# ================= FastAPI =================

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"msg": "Depth Service Running"}


# ================= 加载模型（只加载一次）=================

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

semantics_pth = os.path.join(BASE_DIR, "pixel-perfect-depth/checkpoints/depth_anything_v2_vitl.pth")
model_pth = os.path.join(BASE_DIR, "pixel-perfect-depth/checkpoints/ppd.pth")

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


# ================= 工具函数 =================




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

            # 如果尺寸有微调，插值回原始尺寸
            if patch_h != H or patch_w != W:
                print("🔄 正在将深度图插值回原图尺寸...")
                depth = F.interpolate(
                    depth,
                    size=(H, W),
                    mode="bilinear",
                    align_corners=False
                )[0, 0]
            else:
                depth = depth[0, 0]
                
            print("✅ 尺寸调整完成")

        depth = depth.cpu().numpy()

        # ========= 1. 归一化 (0~1) =========
        depth = (depth - depth.min()) / (depth.max() - depth.min() + 1e-6)

        # ========= 2. 反转深度图 (浅色=近) =========
        depth = 1.0 - depth

        # ========= 3. 背景剔除 (Background Removal) =========
        # 使用 Otsu's 二值化找到前景/背景阈值
        # 先转为 0-255 uint8 计算阈值
        depth_u8_temp = (depth * 255).astype(np.uint8)
        otsu_thresh, _ = cv2.threshold(depth_u8_temp, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
        # 稍微降低 Otsu 阈值，保留更多主体边缘，避免切太狠
        # 归一化回 0-1
        bg_thresh = (otsu_thresh / 255.0) * 0.5 
        print(f"✂️ 背景剔除阈值: {bg_thresh:.3f} (Otsu: {otsu_thresh})")
        
        # 将背景压平为 0
        depth[depth < bg_thresh] = 0.0
        
        # 重新归一化前景部分，拉伸对比度
        mask = depth > 0
        if mask.any():
            d_min = depth[mask].min()
            d_max = depth[mask].max()
            depth[mask] = (depth[mask] - d_min) / (d_max - d_min + 1e-6)

        # ========= 4. 纹理细节叠加 (Texture Detail Enhancement) =========
        # 提取原图的高频细节 (High-pass filter)
        gray_image = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
        
        # 调整 gray_image 尺寸以匹配 depth (如果之前有 resize/interpolate)
        # 这里 depth 已经是 H, W 了，gray_image 也是 H, W
        gray_image = gray_image.astype(np.float32) / 255.0
        
        # 使用高斯模糊提取低频，原图减去低频得到高频
        blurred_gray = cv2.GaussianBlur(gray_image, (0, 0), 3.0)
        high_pass = gray_image - blurred_gray
        
        # 增强高频细节权重
        detail_weight = 0.15
        
        # 叠加细节 (只在非背景区域叠加)
        # 细节可能为负，所以叠加后需要 clip
        depth[mask] += high_pass[mask] * detail_weight
        depth = np.clip(depth, 0.0, 1.0)

        # ========= 5. Gamma 拉伸 =========
        depth = np.power(depth, 0.6)   

        # ========= 6. 最终输出转换 =========
        depth = (depth * 255.0).astype(np.uint8)

        # ========= 7. 轻微平滑消除噪点 =========
        depth = cv2.GaussianBlur(depth, (3, 3), 0)

        print(f"💾 正在保存结果到: {out_path}")
        cv2.imwrite(out_path, depth)
        print("🎉 深度图保存成功")
        
    except Exception as e:
        print(f"❌ 推理过程中发生错误: {str(e)}")
        import traceback
        traceback.print_exc()
        raise e


# ================= 接口 =================

import asyncio

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

class DepthByUrlRequest(BaseModel):
    image_url: str

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
