import { Link, useNavigate } from "@tanstack/react-router";

import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { authClient } from "@/lib/auth";

import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

export default function UserMenu() {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <Skeleton className="h-9 w-24" />;
  }

  if (!session) {
    return (
      <Link to="/auth/sign-in">
        <Button variant="outline">Sign In</Button>
      </Link>
    );
  }

  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline" />}>{session.user.name}</MenuTrigger>
      <MenuPopup className="bg-card">
        <MenuGroup>
          <MenuGroupLabel>My Account</MenuGroupLabel>
          <MenuSeparator />
          <MenuItem>{session.user.email}</MenuItem>
          <MenuItem
            variant="destructive"
            onClick={() => {
              authClient.signOut({
                fetchOptions: {
                  onSuccess: () => {
                    navigate({
                      to: "/",
                    });
                  },
                },
              });
            }}
          >
            Sign Out
          </MenuItem>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}
