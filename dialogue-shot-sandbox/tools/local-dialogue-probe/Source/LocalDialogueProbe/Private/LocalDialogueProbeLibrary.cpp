#include "LocalDialogueProbeLibrary.h"

#include "Dom/JsonObject.h"
#include "EdGraph/EdGraph.h"
#include "EdGraph/EdGraphNode.h"
#include "EdGraph/EdGraphPin.h"
#include "EdGraph/EdGraphSchema.h"
#include "Editor.h"
#include "Modules/ModuleManager.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "UObject/GarbageCollection.h"
#include "UObject/Package.h"
#include "UObject/UObjectGlobals.h"
#include "UObject/UnrealType.h"

IMPLEMENT_MODULE(FDefaultModuleImpl, LocalDialogueProbe)

namespace
{
const TCHAR* TestAssetPrefix = TEXT("/Game/Developers/LocalDialogueToolsProbe/");

FString Encode(const TSharedRef<FJsonObject>& Result)
{
    FString Text;
    TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&Text);
    FJsonSerializer::Serialize(Result, Writer);
    return Text;
}

FString Fail(const FString& Code, const FString& Message)
{
    TSharedRef<FJsonObject> Result = MakeShared<FJsonObject>();
    Result->SetBoolField(TEXT("success"), false);
    Result->SetStringField(TEXT("code"), Code);
    Result->SetStringField(TEXT("message"), Message);
    Result->SetBoolField(TEXT("write_capability_verified"), false);
    return Encode(Result);
}

TArray<TSharedPtr<FJsonValue>> DescribeNodes(const UEdGraph* Graph)
{
    TArray<TSharedPtr<FJsonValue>> Result;
    for (const UEdGraphNode* Node : Graph->Nodes)
    {
        if (!IsValid(Node))
        {
            continue;
        }
        TSharedRef<FJsonObject> Row = MakeShared<FJsonObject>();
        Row->SetStringField(TEXT("object_path"), Node->GetPathName());
        Row->SetStringField(TEXT("class_path"), Node->GetClass()->GetPathName());
        Row->SetStringField(TEXT("guid"), Node->NodeGuid.ToString());
        TArray<TSharedPtr<FJsonValue>> Pins;
        for (const UEdGraphPin* Pin : Node->Pins)
        {
            if (!Pin)
            {
                continue;
            }
            TSharedRef<FJsonObject> PinRow = MakeShared<FJsonObject>();
            PinRow->SetStringField(TEXT("id"), Pin->PinId.ToString());
            PinRow->SetStringField(TEXT("name"), Pin->PinName.ToString());
            PinRow->SetStringField(TEXT("category"), Pin->PinType.PinCategory.ToString());
            PinRow->SetStringField(TEXT("direction"), Pin->Direction == EGPD_Input ? TEXT("in") : TEXT("out"));
            PinRow->SetNumberField(TEXT("link_count"), Pin->LinkedTo.Num());
            Pins.Add(MakeShared<FJsonValueObject>(PinRow));
        }
        Row->SetArrayField(TEXT("pins"), Pins);
        Result.Add(MakeShared<FJsonValueObject>(Row));
    }
    return Result;
}
}

FString ULocalDialogueProbeLibrary::InspectLoadedDialogGraph(
    const FString& AssetObjectPath, bool bEnumerateActions)
{
    // Check editor state before resolving objects. Never try to restore user assets.
    if (!IsInGameThread() || GIsSavingPackage || IsGarbageCollecting() || IsAsyncLoading())
    {
        return Fail(TEXT("EDITOR_BUSY"), TEXT("Retry manually after saving, loading or GC completes."));
    }
    if (!GEditor || GEditor->PlayWorld)
    {
        return Fail(TEXT("EDITOR_BUSY"), TEXT("An idle editor outside PIE is required."));
    }
    if (!AssetObjectPath.StartsWith(TEXT("/Game/")) || AssetObjectPath.Contains(TEXT(":")))
    {
        return Fail(TEXT("INVALID_ASSET_PATH"), TEXT("Pass a /Game package.object path, not a subobject."));
    }
    if (bEnumerateActions && !AssetObjectPath.StartsWith(TestAssetPrefix))
    {
        return Fail(TEXT("TEST_COPY_REQUIRED"), TEXT("Enumerate actions only on a copy under /Game/Developers/LocalDialogueToolsProbe/."));
    }

    UObject* Asset = FindObject<UObject>(nullptr, *AssetObjectPath);
    if (!IsValid(Asset) || Asset->HasAnyFlags(RF_ClassDefaultObject | RF_ArchetypeObject))
    {
        return Fail(TEXT("ASSET_NOT_LOADED"), TEXT("Open the test asset manually first. This probe does not load assets."));
    }
    if (Asset->GetClass()->GetPathName() != TEXT("/Script/SeriaDialogEditor.SeriaDialogGraph"))
    {
        return Fail(TEXT("UNSUPPORTED_CLASS"), TEXT("Expected a native SeriaDialogGraph asset."));
    }

    // Read the reflected graph reference without including Seria private headers.
    FObjectPropertyBase* GraphProperty = FindFProperty<FObjectPropertyBase>(Asset->GetClass(), TEXT("EdDialogGraph"));
    UEdGraph* Graph = GraphProperty
        ? Cast<UEdGraph>(GraphProperty->GetObjectPropertyValue_InContainer(Asset))
        : nullptr;
    if (!IsValid(Graph) || Graph->GetOutermost() != Asset->GetOutermost())
    {
        return Fail(TEXT("GRAPH_UNAVAILABLE"), TEXT("No same-package serialized editor graph was found."));
    }
    const UEdGraphSchema* Schema = Graph->GetSchema();
    if (!Schema || Schema->GetClass()->GetPathName() != TEXT("/Script/SeriaDialogEditor.SeriaDialogGraphSchema"))
    {
        return Fail(TEXT("UNSUPPORTED_SCHEMA"), TEXT("Expected the native Seria dialog schema."));
    }
    if (bEnumerateActions && Asset->GetOutermost()->IsDirty())
    {
        return Fail(TEXT("DIRTY_TEST_COPY"), TEXT("Use a clean test copy before enumerating actions."));
    }

    TSharedRef<FJsonObject> Result = MakeShared<FJsonObject>();
    Result->SetBoolField(TEXT("success"), true);
    Result->SetBoolField(TEXT("write_capability_verified"), false);
    Result->SetStringField(TEXT("asset"), Asset->GetPathName());
    Result->SetStringField(TEXT("graph"), Graph->GetPathName());
    Result->SetStringField(TEXT("graph_class"), Graph->GetClass()->GetPathName());
    Result->SetStringField(TEXT("schema"), Schema->GetClass()->GetPathName());
    Result->SetArrayField(TEXT("nodes"), DescribeNodes(Graph));
    Result->SetBoolField(TEXT("actions_enumerated"), bEnumerateActions);
    if (bEnumerateActions)
    {
        const TArray<UEdGraphNode*> NodesBefore = Graph->Nodes;
        TArray<TSharedPtr<FJsonValue>> Actions;
        {
            // Virtual dispatch must reach the project's schema, not a K2 factory.
            // No action is executed; action indices are valid for this listing only.
            FGraphContextMenuBuilder Builder(Graph);
            Schema->GetGraphContextActions(Builder);
            for (int32 Index = 0; Index < Builder.GetNumActions(); ++Index)
            {
                TSharedPtr<FEdGraphSchemaAction> Action = Builder.GetAction(Index);
                if (!Action.IsValid())
                {
                    continue;
                }
                TSharedRef<FJsonObject> Row = MakeShared<FJsonObject>();
                Row->SetNumberField(TEXT("listing_index"), Index);
                Row->SetStringField(TEXT("type"), Action->GetTypeId().ToString());
                Row->SetStringField(TEXT("title"), Action->GetMenuDescription().ToString());
                Row->SetStringField(TEXT("category"), Action->GetCategory().ToString());
                Actions.Add(MakeShared<FJsonValueObject>(Row));
            }
        }
        if (Asset->GetOutermost()->IsDirty() || NodesBefore != Graph->Nodes)
        {
            return Fail(TEXT("ENUMERATION_SIDE_EFFECT"), TEXT("Schema enumeration changed the test copy. Stop; do not save it. No automatic restore was attempted."));
        }
        Result->SetArrayField(TEXT("actions"), Actions);
    }
    Result->SetBoolField(TEXT("dirty"), Asset->GetOutermost()->IsDirty());
    return Encode(Result);
}
