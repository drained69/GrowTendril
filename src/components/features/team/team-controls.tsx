"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { changeRoleAction, inviteMemberAction } from "@/server/actions/team";
import { Button, Callout, Field, Input, Select } from "@/components/ui";
import { CopyField } from "@/components/ui/copy";
import { toast } from "@/components/ui/toast";

type RoleOption = { value: string; label: string; help: string };

export function RoleSelect({ userId, role, options, disabled, name }: { userId: string; role: string; options: RoleOption[]; disabled?: boolean; name: string }) {
  const [value, setValue] = useState(role);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Select
      aria-label={`Role for ${name}`}
      value={value}
      disabled={disabled || pending}
      className="h-7 w-[110px] text-[12px]"
      onChange={(e) => {
        const next = e.target.value;
        const prev = value;
        setValue(next);
        start(async () => {
          const r = await changeRoleAction(userId, next);
          if (!r.ok) {
            setValue(prev);
            toast.error("Couldn’t change role", r.error);
          } else toast.success(r.message ?? "Role updated", `${name} is now ${options.find((o) => o.value === next)?.label ?? next}`);
          router.refresh();
        });
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

export function InviteForm({ options, defaultRole = "member" }: { options: RoleOption[]; defaultRole?: string }) {
  const [role, setRole] = useState(defaultRole);
  const [link, setLink] = useState<{ url: string; email: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-3">
      <form
        className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const email = String(new FormData(form).get("email") ?? "").trim();
          start(async () => {
            const r = await inviteMemberAction(email, role);
            if (!r.ok) toast.error("Couldn’t create invite", r.error);
            else if (r.data) {
              setLink({ url: r.data.url, email });
              form.reset();
              toast.success("Invite link created", "Share it with the invitee — it is shown only once.");
            }
            router.refresh();
          });
        }}
      >
        <Field label="Email" htmlFor="invite-email" required>
          <Input id="invite-email" name="email" type="email" required placeholder="teammate@company.com" autoComplete="off" />
        </Field>
        <Field label="Role" htmlFor="invite-role">
          <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value)}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="primary" size="md" icon={<UserPlus />} loading={pending}>
          Create invite
        </Button>
      </form>
      <p className="text-[11.5px] text-ink-3">{options.find((o) => o.value === role)?.help}</p>
      {link && (
        <Callout tone="success" title={`Invite link for ${link.email}`}>
          <CopyField value={link.url} className="mt-2" />
          <p className="mt-2 text-[11.5px]">Anyone with this link can join as {link.email} — GrowTendril doesn&apos;t send or verify email, so share it privately. It&apos;s single-use, expires in 7 days, and is shown only once.</p>
        </Callout>
      )}
    </div>
  );
}
