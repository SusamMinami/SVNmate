using UnrealBuildTool;

public class LocalDialogueProbe : ModuleRules
{
    public LocalDialogueProbe(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new string[] {
            "Core", "CoreUObject", "Engine"
        });
        PrivateDependencyModuleNames.AddRange(new string[] {
            "UnrealEd", "Json", "SlateCore"
        });
    }
}
