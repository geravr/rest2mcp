import type { AuthFormState, AuthFormType } from "@/lib/server-auth";
import { useTranslations } from "@/i18n/use-translations";
import {
  Field,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui";

const TYPED_OPTIONS: AuthFormType[] = [
  "none",
  "bearer",
  "header",
  "query",
  "basic",
];

export function ServerAuthFields({
  value,
  onChange,
  includeCustom = false,
  disabled = false,
  idPrefix = "auth",
}: {
  value: AuthFormState;
  onChange: (next: AuthFormState) => void;
  includeCustom?: boolean;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const { t } = useTranslations();
  const options = includeCustom
    ? ([...TYPED_OPTIONS, "custom"] as AuthFormType[])
    : TYPED_OPTIONS;

  const set = <K extends keyof AuthFormState>(key: K, next: AuthFormState[K]) =>
    onChange({ ...value, [key]: next });

  const typeLabel = (type: AuthFormType) => {
    switch (type) {
      case "none":
        return t.servers.authTypeNone;
      case "bearer":
        return t.servers.authTypeBearer;
      case "header":
        return t.servers.authTypeHeader;
      case "query":
        return t.servers.authTypeQuery;
      case "basic":
        return t.servers.authTypeBasic;
      case "custom":
        return t.servers.authTypeCustom;
    }
  };

  return (
    <div className="space-y-3">
      <Field>
        <Label htmlFor={`${idPrefix}-type`}>{t.servers.authType}</Label>
        <Select
          value={value.type}
          disabled={disabled}
          onValueChange={(next) => set("type", next as AuthFormType)}
        >
          <SelectTrigger id={`${idPrefix}-type`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {typeLabel(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {value.type === "custom" ? (
        <p className="text-sm text-muted-foreground">
          {t.servers.authCustomHelp}
        </p>
      ) : null}

      {value.type === "bearer" ? (
        <Field>
          <Label htmlFor={`${idPrefix}-token`}>{t.servers.authToken}</Label>
          <Input
            id={`${idPrefix}-token`}
            type="password"
            autoComplete="off"
            value={value.token}
            disabled={disabled}
            onChange={(event) => set("token", event.target.value)}
            placeholder={t.servers.authTokenPlaceholder}
          />
        </Field>
      ) : null}

      {value.type === "header" ? (
        <>
          <Field>
            <Label htmlFor={`${idPrefix}-header-name`}>
              {t.servers.authHeaderName}
            </Label>
            <Input
              id={`${idPrefix}-header-name`}
              value={value.headerName}
              disabled={disabled}
              onChange={(event) => set("headerName", event.target.value)}
              placeholder={t.servers.authHeaderNamePlaceholder}
            />
          </Field>
          <Field>
            <Label htmlFor={`${idPrefix}-header-value`}>
              {t.servers.authHeaderValue}
            </Label>
            <Input
              id={`${idPrefix}-header-value`}
              type="password"
              autoComplete="off"
              value={value.headerValue}
              disabled={disabled}
              onChange={(event) => set("headerValue", event.target.value)}
              placeholder={t.servers.authValuePlaceholder}
            />
          </Field>
        </>
      ) : null}

      {value.type === "query" ? (
        <>
          <Field>
            <Label htmlFor={`${idPrefix}-param-name`}>
              {t.servers.authParamName}
            </Label>
            <Input
              id={`${idPrefix}-param-name`}
              value={value.paramName}
              disabled={disabled}
              onChange={(event) => set("paramName", event.target.value)}
              placeholder={t.servers.authParamNamePlaceholder}
            />
          </Field>
          <Field>
            <Label htmlFor={`${idPrefix}-param-value`}>
              {t.servers.authParamValue}
            </Label>
            <Input
              id={`${idPrefix}-param-value`}
              type="password"
              autoComplete="off"
              value={value.paramValue}
              disabled={disabled}
              onChange={(event) => set("paramValue", event.target.value)}
              placeholder={t.servers.authValuePlaceholder}
            />
          </Field>
        </>
      ) : null}

      {value.type === "basic" ? (
        <>
          <Field>
            <Label htmlFor={`${idPrefix}-username`}>
              {t.servers.authUsername}
            </Label>
            <Input
              id={`${idPrefix}-username`}
              autoComplete="off"
              value={value.username}
              disabled={disabled}
              onChange={(event) => set("username", event.target.value)}
            />
          </Field>
          <Field>
            <Label htmlFor={`${idPrefix}-password`}>
              {t.servers.authPassword}
            </Label>
            <Input
              id={`${idPrefix}-password`}
              type="password"
              autoComplete="off"
              value={value.password}
              disabled={disabled}
              onChange={(event) => set("password", event.target.value)}
            />
          </Field>
        </>
      ) : null}
    </div>
  );
}
