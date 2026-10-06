FROM node:22.23.2-bookworm-slim
WORKDIR /app
RUN npm install --global pnpm@12.3.4
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55322
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
ENV BACKBEAT_ENV=development
ENV NEXT_PUBLIC_BACKBEAT_ENV=development
ENV BACKBEAT_CALENDAR_TIME_ZONE=Europe/Rome
ENV NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL=http://127.0.0.1:3101/onboarding
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build && chown -R node:node .next
ENV NODE_ENV=production
USER node
EXPOSE 3101
CMD ["node", "ops/local/start.cjs"]
