FROM python:3.10-slim

# libgl1/libglib2.0-0: several of Surya's image-processing dependencies
# (via OpenCV/Pillow's transitive chain) need these at runtime even
# headless; a plain python:3.10-slim image doesn't have them.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Plain `pip install torch` pulls the CUDA-enabled build by default on
# Linux — several hundred MB to multiple GB of NVIDIA CUDA runtime
# libraries (cublas, cufft, cudnn, ...) that a CPU-only container never
# uses. Installing the CPU-only build from PyTorch's own wheel index
# *before* requirements.txt means surya-ocr's own `torch` dependency is
# already satisfied by the time pip processes it, so it never reaches for
# the default (CUDA) variant.
RUN pip install --no-cache-dir "torch<3.0.0" --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Downloads Surya's detection + recognition model weights at build time
# (into the image) rather than on first request — a cold request
# shouldn't have to wait for a multi-hundred-MB model download, and this
# keeps the running container usable offline after the image is built
# once. Deliberately *before* `COPY main.py` (which doesn't affect this
# step at all — it only imports from surya, not main.py) so iterating on
# main.py during development doesn't invalidate this layer and force a
# multi-minute model re-download on every change.
RUN python -c "\
from surya.model.detection.model import load_model as load_det_model, load_processor as load_det_processor; \
from surya.model.recognition.model import load_model as load_rec_model; \
from surya.model.recognition.processor import load_processor as load_rec_processor; \
load_det_model(); load_det_processor(); load_rec_model(); load_rec_processor()"

COPY main.py .

EXPOSE 8868
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8868"]
