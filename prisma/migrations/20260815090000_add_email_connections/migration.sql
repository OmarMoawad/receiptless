-- CreateTable
CREATE TABLE "EmailConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "providerAccountEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "encryptedTokenData" TEXT,
    "lastScannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthConnectChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pkceVerifier" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "OAuthConnectChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailConnection_userId_provider_providerAccountId_key" ON "EmailConnection"("userId", "provider", "providerAccountId");
CREATE INDEX "EmailConnection_userId_idx" ON "EmailConnection"("userId");
CREATE UNIQUE INDEX "OAuthConnectChallenge_state_key" ON "OAuthConnectChallenge"("state");
CREATE INDEX "OAuthConnectChallenge_userId_idx" ON "OAuthConnectChallenge"("userId");

-- AddForeignKey
ALTER TABLE "EmailConnection" ADD CONSTRAINT "EmailConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
