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
    allow_origins=["http://localhost:5173"],
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

DEVICE = torch.device(
    "cuda"
    if torch.cuda.is_available()
    else "mps"
    if torch.backends.mps.is_available()
    else "cpu"
)

semantics_pth = os.path.join(BASE_DIR, "pixel-perfect-depth/checkpoints/depth_anything_v2_vitl.pth")
model_pth = os.path.join(BASE_DIR, "pixel-perfect-depth/checkpoints/ppd.pth")

model = PixelPerfectDepth(
    semantics_model="DA2",
    semantics_pth=semantics_pth,
    sampling_steps=4,
)

model.load_state_dict(
    torch.load(model_pth, map_location="cpu"),
    strict=False
)

model = model.to(DEVICE).eval()

print("✅ 模型加载完成，设备:", DEVICE)


# ================= 工具函数 =================




def run_depth(image_path: str, out_path: str):

    image = cv2.imread(image_path)
    H, W = image.shape[:2]

    with torch.no_grad():
        depth, _ = model.infer_image(image)

        depth = F.interpolate(
            depth,
            size=(H, W),
            mode="bilinear",
            align_corners=False
        )[0, 0]

    depth = depth.cpu().numpy()

    # ========= 1. 归一化 =========
    depth = (depth - depth.min()) / (depth.max() - depth.min() + 1e-6)

    # ========= 2. Gamma 拉伸（重点）=========
    depth = np.power(depth, 0.5)   # 0.4~0.7 都可以试

    # ========= 3. 对比增强 =========
    depth = cv2.normalize(
        depth, None,
        alpha=0, beta=255,
        norm_type=cv2.NORM_MINMAX
    )

    depth = depth.astype(np.uint8)

    # ========= 4. 可选：轻微平滑 =========
    depth = cv2.GaussianBlur(depth, (3, 3), 0)

    cv2.imwrite(out_path, depth)


# ================= 接口 =================

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

    run_depth(input_path, output_path)

    print("✅ 推理完成:", output_path)

    # 返回图片
    with open(output_path, "rb") as f:
        result = f.read()

    return Response(
        content=result,
        media_type="image/png"
    )

@app.get("/depth/latest")
def get_latest_depth():
    files = sorted(
        os.listdir(OUTPUT_DIR),
        key=lambda x: os.path.getmtime(os.path.join(OUTPUT_DIR, x)),
        reverse=True
    )

    if not files:
        return {"error": "no depth file"}

    path = os.path.join(OUTPUT_DIR, files[0])

    return FileResponse(path, media_type="image/png")