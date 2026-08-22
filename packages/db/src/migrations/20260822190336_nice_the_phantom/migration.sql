ALTER TABLE "platform_settings" ADD COLUMN "sign_in_password_enabled" boolean;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "sign_in_passkey_enabled" boolean;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "sign_in_sso_enabled" boolean;