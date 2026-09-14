// Testa CanEnterChannelWithVipLevel direto do NtlAdmin.h de verdade -- nada de copia,
// para nao validar uma versao paralela da regra.
#include <windows.h>
#include <stdio.h>
#include "NtlAdmin.h"

static int g_falhas = 0;

static void Checa(BYTE byCanal, BYTE byConta, bool bGm, bool bEsperado, const char* szCaso)
{
    bool bObtido = CanEnterChannelWithVipLevel(byCanal, byConta, bGm);
    bool bOk = (bObtido == bEsperado);
    if (!bOk) g_falhas++;
    printf("  %-5s  canal=%u conta=%u gm=%d  entra=%d esperado=%d   %s\n",
           bOk ? "ok" : "FALHA", byCanal, byConta, (int)bGm, (int)bObtido, (int)bEsperado, szCaso);
}

int main()
{
    printf("canal comum (VipLevel 0) -- aberto a todos:\n");
    Checa(VIP_LEVEL_NONE, VIP_LEVEL_NONE, false, true,  "conta comum no canal comum");
    Checa(VIP_LEVEL_NONE, VIP_LEVEL_1,    false, true,  "VIP 1 tambem usa o canal comum");
    Checa(VIP_LEVEL_NONE, VIP_LEVEL_2,    false, true,  "VIP 2 tambem usa o canal comum");
    Checa(VIP_LEVEL_NONE, VIP_LEVEL_3,    false, true,  "VIP 3 tambem usa o canal comum");

    printf("\ncanal do VIP 1 -- so quem e VIP 1:\n");
    Checa(VIP_LEVEL_1, VIP_LEVEL_NONE, false, false, "conta comum e barrada");
    Checa(VIP_LEVEL_1, VIP_LEVEL_1,    false, true,  "VIP 1 entra");
    Checa(VIP_LEVEL_1, VIP_LEVEL_2,    false, false, "VIP 2 NAO entra no canal do 1");
    Checa(VIP_LEVEL_1, VIP_LEVEL_3,    false, false, "VIP 3 NAO entra no canal do 1");

    printf("\ncanal do VIP 2 -- so quem e VIP 2:\n");
    Checa(VIP_LEVEL_2, VIP_LEVEL_NONE, false, false, "conta comum e barrada");
    Checa(VIP_LEVEL_2, VIP_LEVEL_1,    false, false, "VIP 1 NAO entra no canal do 2");
    Checa(VIP_LEVEL_2, VIP_LEVEL_2,    false, true,  "VIP 2 entra");
    Checa(VIP_LEVEL_2, VIP_LEVEL_3,    false, false, "VIP 3 NAO entra no canal do 2");

    printf("\ncanal do VIP 3 -- so quem e VIP 3:\n");
    Checa(VIP_LEVEL_3, VIP_LEVEL_2,    false, false, "VIP 2 NAO entra no canal do 3");
    Checa(VIP_LEVEL_3, VIP_LEVEL_3,    false, true,  "VIP 3 entra");

    printf("\nGM passa por tudo:\n");
    Checa(VIP_LEVEL_1, VIP_LEVEL_NONE, true, true, "GM sem VIP no canal do 1");
    Checa(VIP_LEVEL_2, VIP_LEVEL_NONE, true, true, "GM sem VIP no canal do 2");
    Checa(VIP_LEVEL_3, VIP_LEVEL_1,    true, true, "GM com VIP 1 no canal do 3");

    printf("\n%s (%d falha(s))\n", g_falhas ? "FALHOU" : "TUDO OK", g_falhas);
    return g_falhas ? 1 : 0;
}
