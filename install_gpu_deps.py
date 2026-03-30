import subprocess
import sys
import platform

def check_cuda_version():
    """检查系统CUDA版本"""
    try:
        if platform.system() == "Windows":
            result = subprocess.run(["nvidia-smi"], capture_output=True, text=True)
        else:
            result = subprocess.run(["nvidia-smi"], capture_output=True, text=True)
        output = result.stdout
        for line in output.split('\n'):
            if 'CUDA Version:' in line:
                return line.split('CUDA Version:')[1].strip().split(' ')[0]
        return None
    except Exception:
        return None

def install_pytorch(cuda_version):
    """根据CUDA版本安装PyTorch"""
    if cuda_version:
        # 提取主版本号，如 12.1 -> 121
        cuda_main = ''.join(cuda_version.split('.')[:2])
        print(f"检测到CUDA版本: {cuda_version}")
        print(f"正在安装支持CUDA {cuda_version}的PyTorch...")
        
        # 安装命令
        cmd = [
            sys.executable, "-m", "pip", "install",
            "torch", "torchvision", "torchaudio"
        ]
        
        try:
            subprocess.run(cmd, check=True)
            print("✅ PyTorch安装成功！")
        except subprocess.CalledProcessError:
            print("⚠️ PyTorch安装失败，尝试指定CUDA版本...")
            # 尝试指定CUDA版本
            try:
                cmd = [
                    sys.executable, "-m", "pip", "install",
                    f"torch==2.1.0+cu{cuda_main}",
                    f"torchvision==0.16.0+cu{cuda_main}",
                    f"torchaudio==2.1.0+cu{cuda_main}",
                    "--index-url", f"https://download.pytorch.org/whl/cu{cuda_main}"
                ]
                subprocess.run(cmd, check=True)
                print("✅ 指定CUDA版本的PyTorch安装成功！")
            except subprocess.CalledProcessError:
                print("⚠️ 指定版本安装失败，尝试安装CPU版本...")
                # 安装CPU版本
                cmd = [
                    sys.executable, "-m", "pip", "install",
                    "torch", "torchvision", "torchaudio",
                    "--index-url", "https://download.pytorch.org/whl/cpu"
                ]
                subprocess.run(cmd, check=True)
    else:
        print("未检测到CUDA，安装CPU版本的PyTorch...")
        cmd = [
            sys.executable, "-m", "pip", "install",
            "torch", "torchvision", "torchaudio",
            "--index-url", "https://download.pytorch.org/whl/cpu"
        ]
        subprocess.run(cmd, check=True)

def main():
    print("开始检测GPU并安装依赖...")
    
    # 安装基础依赖
    print("安装基础依赖...")
    subprocess.run([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"], check=True)
    
    # 检测CUDA版本并安装PyTorch
    cuda_version = check_cuda_version()
    install_pytorch(cuda_version)
    
    print("🎉 依赖安装完成！")

if __name__ == "__main__":
    main()