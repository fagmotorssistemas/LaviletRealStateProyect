# Analizador de planos (OpenCV) — pipeline opencv-v2

## Setup

```bash
cd python
python -m venv .venv
# Windows:
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8001
```

OCR opcional: instalar [Tesseract](https://github.com/tesseract-ocr/tesseract).

## Pipeline v2

1. Preprocess (CLAHE, bilateral, morph gradient)
2. Walls: Canny multi-umbral + HoughLinesP + paredes claras/oscuras + morfología
3. Corridor band (proyección / color)
4. Door-gap closing ligero (kernels anisotrópicos)
5. Exterior flood desde bordes
6. **Medianeras** (column score) + flood por bahía → contorno exterior real  
   Fallback: connected components
7. Clasificación apt / corridor / core
8. OCR + asociación

Debug:

```bash
python diagnose_pipeline.py
# → python/_debug/*_overlay.png
```

Health: `GET http://127.0.0.1:8001/health`  
Analyze: `POST http://127.0.0.1:8001/analyze` (multipart `image`)
