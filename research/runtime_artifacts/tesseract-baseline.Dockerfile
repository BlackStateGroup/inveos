# Research baseline only. Source-head comparison and product approval stay separate.
FROM python@sha256:623674a14ef93d052bb9b0de4dbf5f28eb578a35263838941cc8aa43213c1487
# All 161 installed package archives are SHA-256 verified before build. The
# digest-pinned base supplies Python; no rolling repository resolution is allowed.
COPY packages /tmp/ocr-packages
RUN DEBIAN_FRONTEND=noninteractive apt-get install --no-download --no-remove --no-install-recommends -y /tmp/ocr-packages/*.deb \
    && rm -rf /tmp/ocr-packages && apt-get clean
