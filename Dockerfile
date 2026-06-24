# Use official Node.js image
FROM node:18

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy all website files
COPY . .

# Expose Hugging Face's mandatory port
EXPOSE 7860

# Start your server.js
CMD ["node", "server.js"]
