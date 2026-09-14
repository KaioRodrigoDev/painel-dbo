// Quanto do pacote de 4095 bytes a lista de canais ja ocupa, e quanto sobra para
// acrescentar campo no _CHANNEL_BUFF (que e multiplicado por 10 canais).
#include <windows.h>
#include <stdio.h>
#include "NtlSharedDef.h"
#include "NtlCSArchitecture.h"

int main()
{
    const int MAXP = 4095;
    const int N = NTL_MAX_SERVER_CHANNEL_COUNT_IN_SERVER_FARM;

    printf("canais por farm ............ %d\n", N);
    printf("_CHANNEL_BUFF .............. %d bytes\n", (int)sizeof(_CHANNEL_BUFF));
    printf("sDBO_GAME_SERVER_CHANNEL_INFO %d bytes\n", (int)sizeof(sDBO_GAME_SERVER_CHANNEL_INFO));

    int lista = (int)sizeof(sDBO_GAME_SERVER_CHANNEL_INFO) * N;
    printf("\nlista de %d canais .......... %d bytes\n", N, lista);
    printf("limite do pacote ........... %d bytes\n", MAXP);
    printf("folga (sem contar opcode/contador/alinhamento) %d bytes\n", MAXP - lista);
    printf("  -> por canal ............. %d bytes\n", (MAXP - lista) / N);
    printf("  -> em WCHAR por canal .... %d\n", (MAXP - lista) / N / 2);
    return 0;
}
