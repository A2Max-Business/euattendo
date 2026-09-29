"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { toast } from "sonner";
import { traduzir } from "@/lib/i18n/dicionario";
import { idiomaAtual } from "@/lib/i18n/IdiomaProvider";

function toastDeBloqueioPorVinculo(err: ApiError): boolean {
  // A pré-checagem do handler põe `{ vinculos }` em `error.details` (issue
  // #1925). Se vier, a mensagem genérica cede lugar a uma que diz O QUE barrou
  // e O QUE fazer — com link para a Agenda, que é onde se desfaz o vínculo.
  const vinculos = err.details?.vinculos;
  if (!Array.isArray(vinculos) || vinculos.length === 0) return false;
  const unicos = [...new Set(vinculos as string[])];
  const descricao =
    unicos.length === 1
      ? `Este contato tem ${unicos[0]}. Cancele ou apague o compromisso na Agenda antes de excluir.`
      : `Este contato ainda tem: ${unicos.join(", ")}. Resolva os vínculos na Agenda antes de excluir.`;
  const t = (s: string) => traduzir(s, idiomaAtual());
  toast.error(t(descricao), {
    action: {
      label: t("Abrir Agenda"),
      onClick: () => {
        window.location.href = "/app/agenda";
      },
    },
  });
  return true;
}

export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (contactId: string) =>
      apiClient.delete<unknown>(`/api/v1/contacts/${contactId}`),
    onError: (err) => {
      if (err instanceof ApiError && toastDeBloqueioPorVinculo(err)) return;
      showApiError(err);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}
