import torch

print("=== GPU 检测测试 ===")
print(f"PyTorch 版本: {torch.__version__}")
print(f"CUDA 可用: {torch.cuda.is_available()}")

if torch.cuda.is_available():
    print(f"GPU 名称: {torch.cuda.get_device_name(0)}")
    print(f"CUDA 版本: {torch.version.cuda}")
    print(f"GPU 数量: {torch.cuda.device_count()}")
else:
    print("未检测到 CUDA GPU")

print(f"MPS 可用: {torch.backends.mps.is_available() if hasattr(torch.backends, 'mps') else 'N/A'}")
print(f"默认设备: {torch.device('cuda' if torch.cuda.is_available() else 'cpu')}")
print("===================")
