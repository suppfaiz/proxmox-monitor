FROM node:18-alpine

WORKDIR /app

# Salin package.json dan pasang dependensi produksi saja
COPY package*.json ./
RUN npm ci --only=production

# Salin seluruh kode backend
COPY . .

# Ekspos port default backend
EXPOSE 5005

# Jalankan server
CMD ["npm", "start"]
