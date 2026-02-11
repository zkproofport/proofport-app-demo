FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json next.config.ts ./
COPY public ./public
COPY app ./app
COPY lib ./lib

EXPOSE 3300

CMD ["npx", "next", "dev", "-p", "3300", "-H", "0.0.0.0"]
