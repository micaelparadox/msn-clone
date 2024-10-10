# Stage 1: Base Node Image
FROM node:18 AS base

# Set the working directory
WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

# Copy the rest of the application code
COPY . .

# Expose the application's port
EXPOSE 3000

# Stage 2: Final Image (no need for volumes here)
FROM base AS final

# Copy everything from the base stage
WORKDIR /usr/src/app

# Run the application using bash to ensure the wait-for-it.sh script works
CMD ["npm", "start"]
