# Research baseline only. Source-head comparison and product approval stay separate.
FROM python@sha256:623674a14ef93d052bb9b0de4dbf5f28eb578a35263838941cc8aa43213c1487
RUN apt-get update && apt-get install --no-install-recommends -y \
    tesseract-ocr=5.3.0-2 tesseract-ocr-eng=1:4.1.0-2 \
    && apt-get clean
