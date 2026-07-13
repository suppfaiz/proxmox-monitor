FROM node:20-alpine

WORKDIR /app

# Salin package.json dan pasang dependensi produksi (instal alat penyusun untuk sqlite3)
COPY package*.json ./
RUN apk add --no-cache python3 make g++ && npm ci --only=production

# Salin seluruh kode backend
COPY . .

# Ekspos port default backend
EXPOSE 5005

# Jalankan server
CMD ["npm", "start"]
