import { getAvatarService } from "@/server/account/avatar-store";
import { avatarRoute } from "@/server/account/avatar-route";
import { withRoleRoute } from "@/server/auth/guard";
import { consumeForUser } from "@/server/rate-limit";

/** Changes the signed-in person's photo (#112). The guard checks the same-origin header and the role first. */
export const POST = withRoleRoute(["CUSTOMER", "TRADIE"], (viewer, request: Request) =>
  avatarRoute(viewer.userId, request, { service: getAvatarService, limit: consumeForUser }));
