#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "LocalDialogueProbeLibrary.generated.h"

UCLASS()
class LOCALDIALOGUEPROBE_API ULocalDialogueProbeLibrary : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()

public:
    // Does not load assets. Action enumeration is restricted to test copies.
    UFUNCTION(BlueprintCallable, Category = "LocalDialogueProbe")
    static FString InspectLoadedDialogGraph(
        const FString& AssetObjectPath,
        bool bEnumerateActions = false);
};
