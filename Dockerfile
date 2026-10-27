# Namiesto Coolify „static“ buildu: rovnaký nginx:alpine, ale s bezpečnostnými opravami
# z Alpine repa hneď pri builde (oficiálny obraz niekedy mešká, napr. brotli 10/2026).
FROM nginx:alpine
RUN apk upgrade --no-cache
COPY . /usr/share/nginx/html
RUN mv /usr/share/nginx/html/nginx-default.conf /etc/nginx/conf.d/default.conf
