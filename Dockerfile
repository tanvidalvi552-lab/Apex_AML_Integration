FROM node:22-bookworm-slim

# Install Python for the AML inference service
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm ci

# Install Python dependencies
COPY aml-model/requirements.txt ./aml-model/requirements.txt
RUN python3 -m pip install \
    --break-system-packages \
    --no-cache-dir \
    -r aml-model/requirements.txt

# Copy the application, including the trained AML model
COPY . .

# Build the React frontend
RUN npm run build

ENV NODE_ENV=production
ENV PYTHON_BIN=python3
ENV PYTHON_INFERENCE_PORT=5001

EXPOSE 10000

CMD ["npm", "start"]