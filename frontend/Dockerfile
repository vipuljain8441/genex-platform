# FROM node:20-bookworm-slim

# WORKDIR /app

# ARG NEXT_PUBLIC_API_URL=http://localhost:8000
# ARG NEXT_PUBLIC_WS_URL=ws://localhost:8000
# ARG NEXT_PUBLIC_SANDBOX_URL=http://localhost:8080

# ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
#     NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL} \
#     NEXT_PUBLIC_SANDBOX_URL=${NEXT_PUBLIC_SANDBOX_URL} \
#     NODE_ENV=production \
#     PORT=3000

# COPY package*.json ./
# RUN if [ -f package-lock.json ]; then npm ci; else npm install --legacy-peer-deps; fi

# COPY . ./

# RUN npm run build

# EXPOSE 3000

# CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "3000"]

FROM node:20-bookworm-slim

WORKDIR /app

ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ARG NEXT_PUBLIC_WS_URL=ws://localhost:8000
ARG NEXT_PUBLIC_SANDBOX_URL=http://localhost:8080

ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL} \
    NEXT_PUBLIC_SANDBOX_URL=${NEXT_PUBLIC_SANDBOX_URL} \
    NODE_ENV=production \
    PORT=3000

COPY frontend/package.json ./
RUN npm install --legacy-peer-deps

COPY frontend ./

RUN npm run dev

EXPOSE 3000

CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "3000"]