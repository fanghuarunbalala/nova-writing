/**
 * Host dispatch decision for one durably accepted Conversation input.
 *
 * Runtime activation is described rather than performed here so command
 * acceptance remains independent from local, child-process, or remote hosts.
 */
export type ConversationInputRoute =
  | Readonly<{
      target: "runtime";
      activation: "required" | "if_online";
    }>
  | Readonly<{
      target: "host";
      handler: "stop" | "reload_config";
      runtimeNotification: "if_online" | "none";
    }>;
