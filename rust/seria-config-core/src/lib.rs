use std::collections::{HashMap, HashSet};
use std::fmt::{Display, Formatter};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

pub const TARGET_FILENAME: &str = "m目标物表.csv";
pub const NPC_FILENAME: &str = "NPC表.csv";
pub const RESOURCE_FILENAME: &str = "m模型资源表.csv";

#[derive(Debug)]
pub enum ConfigError {
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    Csv {
        filename: String,
        row: Option<u64>,
        message: String,
    },
    MissingDoubleHeader {
        filename: String,
    },
    MissingField {
        filename: String,
        field: String,
    },
    InvalidValue {
        filename: String,
        row: u64,
        field: String,
        value: String,
    },
    InvalidDirectory(PathBuf),
    NotFound(String),
}

impl Display for ConfigError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io { path, source } => {
                write!(formatter, "无法读取 {}：{}", path.display(), source)
            }
            Self::Csv {
                filename,
                row,
                message,
            } => match row {
                Some(row) => write!(formatter, "{filename} 第 {row} 行解析失败：{message}"),
                None => write!(formatter, "{filename} 解析失败：{message}"),
            },
            Self::MissingDoubleHeader { filename } => {
                write!(formatter, "{filename} 缺少双表头")
            }
            Self::MissingField { filename, field } => {
                write!(formatter, "{filename} 缺少必需字段：{field}")
            }
            Self::InvalidValue {
                filename,
                row,
                field,
                value,
            } => write!(
                formatter,
                "{filename} 第 {row} 行 {field} 不是整数：{value:?}"
            ),
            Self::InvalidDirectory(path) => {
                write!(formatter, "数据目录不存在：{}", path.display())
            }
            Self::NotFound(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for ConfigError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io { source, .. } => Some(source),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CsvRow {
    pub row_number: u64,
    values: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct DoubleHeaderTable {
    filename: String,
    members: Vec<String>,
    labels: Vec<String>,
    rows: Vec<CsvRow>,
}

impl DoubleHeaderTable {
    pub fn from_path(path: &Path) -> Result<Self, ConfigError> {
        let file = File::open(path).map_err(|source| ConfigError::Io {
            path: path.to_path_buf(),
            source,
        })?;
        Self::from_reader(
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("unknown.csv"),
            file,
        )
    }

    pub fn from_reader(
        filename: impl Into<String>,
        reader: impl Read,
    ) -> Result<Self, ConfigError> {
        let filename = filename.into();
        let mut csv_reader = csv::ReaderBuilder::new()
            .has_headers(false)
            .flexible(true)
            .from_reader(reader);
        let mut records = csv_reader.records();
        let members = next_header(&mut records, &filename)?
            .into_iter()
            .map(normalize_member)
            .collect();
        let labels = next_header(&mut records, &filename)?
            .into_iter()
            .map(|value| value.trim().trim_start_matches("##").to_owned())
            .collect();
        let mut rows = Vec::new();
        for (offset, record) in records.enumerate() {
            let row_number = offset as u64 + 3;
            let record = record.map_err(|error| ConfigError::Csv {
                filename: filename.clone(),
                row: error.position().map(|position| position.line()),
                message: error.to_string(),
            })?;
            let values = record
                .iter()
                .map(|value| value.trim().to_owned())
                .collect::<Vec<_>>();
            if values.iter().all(String::is_empty) {
                continue;
            }
            rows.push(CsvRow { row_number, values });
        }
        Ok(Self {
            filename,
            members,
            labels,
            rows,
        })
    }

    pub fn rows(&self) -> &[CsvRow] {
        &self.rows
    }

    pub fn member_column(&self, member: &str) -> Result<usize, ConfigError> {
        self.members
            .iter()
            .position(|value| value == member)
            .ok_or_else(|| ConfigError::MissingField {
                filename: self.filename.clone(),
                field: member.to_owned(),
            })
    }

    pub fn label_column(&self, label: &str) -> Result<usize, ConfigError> {
        self.labels
            .iter()
            .position(|value| value == label)
            .ok_or_else(|| ConfigError::MissingField {
                filename: self.filename.clone(),
                field: label.to_owned(),
            })
    }

    pub fn label_prefix_column(&self, prefix: &str) -> Result<usize, ConfigError> {
        self.labels
            .iter()
            .position(|value| value.starts_with(prefix))
            .ok_or_else(|| ConfigError::MissingField {
                filename: self.filename.clone(),
                field: format!("{prefix}..."),
            })
    }

    pub fn cell<'a>(&self, row: &'a CsvRow, column: usize) -> &'a str {
        row.values.get(column).map(String::as_str).unwrap_or("")
    }
}

fn next_header<I>(records: &mut I, filename: &str) -> Result<Vec<String>, ConfigError>
where
    I: Iterator<Item = Result<csv::StringRecord, csv::Error>>,
{
    match records.next() {
        Some(Ok(record)) => Ok(record.iter().map(str::to_owned).collect()),
        Some(Err(error)) => Err(ConfigError::Csv {
            filename: filename.to_owned(),
            row: error.position().map(|position| position.line()),
            message: error.to_string(),
        }),
        None => Err(ConfigError::MissingDoubleHeader {
            filename: filename.to_owned(),
        }),
    }
}

fn normalize_member(value: String) -> String {
    value
        .trim_start_matches('\u{feff}')
        .trim()
        .trim_start_matches("##&")
        .to_owned()
}

fn required_integer(
    table: &DoubleHeaderTable,
    row: &CsvRow,
    column: usize,
    field: &str,
) -> Result<i64, ConfigError> {
    let value = table.cell(row, column);
    value.parse::<i64>().map_err(|_| ConfigError::InvalidValue {
        filename: table.filename.clone(),
        row: row.row_number,
        field: field.to_owned(),
        value: value.to_owned(),
    })
}

fn optional_integer(
    table: &DoubleHeaderTable,
    row: &CsvRow,
    column: usize,
    field: &str,
) -> Result<Option<i64>, ConfigError> {
    let value = table.cell(row, column);
    if value.is_empty() {
        return Ok(None);
    }
    required_integer(table, row, column, field).map(Some)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetRecord {
    pub id: i64,
    pub target_type: String,
    pub description: String,
    pub npc_id: Option<i64>,
    pub row_number: u64,
    pub position: String,
    pub rotation: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NpcRecord {
    pub id: i64,
    pub note: String,
    pub name: String,
    pub resource_id: Option<i64>,
    pub row_number: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceRecord {
    pub id: i64,
    pub configured_path: String,
    pub generated_class_path: String,
    pub row_number: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadReport {
    pub csv_directory: String,
    pub target_count: usize,
    pub npc_count: usize,
    pub resource_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QueryKind {
    Target,
    Npc,
    NpcName,
    Resource,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub kind: QueryKind,
    pub query: String,
    pub targets: Vec<TargetRecord>,
    pub npcs: Vec<NpcRecord>,
    pub resources: Vec<ResourceRecord>,
    pub warnings: Vec<String>,
}

#[derive(Debug)]
pub struct CommonConfigDatabase {
    report: LoadReport,
    targets: Vec<TargetRecord>,
    npcs: Vec<NpcRecord>,
    resources: Vec<ResourceRecord>,
    targets_by_id: HashMap<i64, Vec<usize>>,
    targets_by_npc_id: HashMap<i64, Vec<usize>>,
    npcs_by_id: HashMap<i64, Vec<usize>>,
    npcs_by_resource_id: HashMap<i64, Vec<usize>>,
    resources_by_id: HashMap<i64, Vec<usize>>,
    searchable_npc_names: Vec<(String, usize)>,
}

impl CommonConfigDatabase {
    pub fn load(directory: &Path) -> Result<Self, ConfigError> {
        if !directory.is_dir() {
            return Err(ConfigError::InvalidDirectory(directory.to_path_buf()));
        }
        let targets = parse_targets(&DoubleHeaderTable::from_path(
            &directory.join(TARGET_FILENAME),
        )?)?;
        let npcs = parse_npcs(&DoubleHeaderTable::from_path(
            &directory.join(NPC_FILENAME),
        )?)?;
        let resources = parse_resources(&DoubleHeaderTable::from_path(
            &directory.join(RESOURCE_FILENAME),
        )?)?;
        Ok(Self::new(directory, targets, npcs, resources))
    }

    fn new(
        directory: &Path,
        targets: Vec<TargetRecord>,
        npcs: Vec<NpcRecord>,
        resources: Vec<ResourceRecord>,
    ) -> Self {
        let mut database = Self {
            report: LoadReport {
                csv_directory: directory.display().to_string(),
                target_count: targets.len(),
                npc_count: npcs.len(),
                resource_count: resources.len(),
            },
            targets,
            npcs,
            resources,
            targets_by_id: HashMap::new(),
            targets_by_npc_id: HashMap::new(),
            npcs_by_id: HashMap::new(),
            npcs_by_resource_id: HashMap::new(),
            resources_by_id: HashMap::new(),
            searchable_npc_names: Vec::new(),
        };
        for (index, target) in database.targets.iter().enumerate() {
            database
                .targets_by_id
                .entry(target.id)
                .or_default()
                .push(index);
            if let Some(npc_id) = target.npc_id {
                database
                    .targets_by_npc_id
                    .entry(npc_id)
                    .or_default()
                    .push(index);
            }
        }
        for (index, npc) in database.npcs.iter().enumerate() {
            database.npcs_by_id.entry(npc.id).or_default().push(index);
            if let Some(resource_id) = npc.resource_id {
                database
                    .npcs_by_resource_id
                    .entry(resource_id)
                    .or_default()
                    .push(index);
            }
            let normalized_name = normalize_search_text(&npc.name);
            if !normalized_name.is_empty() {
                database.searchable_npc_names.push((normalized_name, index));
            }
        }
        for (index, resource) in database.resources.iter().enumerate() {
            database
                .resources_by_id
                .entry(resource.id)
                .or_default()
                .push(index);
        }
        database
    }

    pub fn report(&self) -> &LoadReport {
        &self.report
    }

    pub fn query(&self, kind: QueryKind, value: &str) -> Result<QueryResult, ConfigError> {
        match kind {
            QueryKind::Target => self.query_target(parse_query_id(value)?),
            QueryKind::Npc => self.query_npc(parse_query_id(value)?),
            QueryKind::NpcName => self.query_npc_name(value),
            QueryKind::Resource => self.query_resource(parse_query_id(value)?),
        }
    }

    fn query_target(&self, id: i64) -> Result<QueryResult, ConfigError> {
        let target_indexes = self
            .targets_by_id
            .get(&id)
            .ok_or_else(|| ConfigError::NotFound(format!("目标物 ID {id} 未找到")))?;
        let mut targets = target_indexes
            .iter()
            .map(|index| self.targets[*index].clone())
            .collect::<Vec<_>>();
        let mut npcs = Vec::new();
        let mut resources = Vec::new();
        let mut warnings = Vec::new();
        for target_index in target_indexes {
            let target = &self.targets[*target_index];
            let Some(npc_id) = positive_reference(
                target.npc_id,
                "NPC ID",
                &format!("目标物 ID {}", target.id),
                &mut warnings,
            ) else {
                continue;
            };
            targets.extend(self.records(&self.targets, self.targets_by_npc_id.get(&npc_id)));
            let linked_npcs = self.records(&self.npcs, self.npcs_by_id.get(&npc_id));
            if linked_npcs.is_empty() {
                warnings.push(format!("NPC ID {npc_id} 未找到"));
                continue;
            }
            for npc in &linked_npcs {
                let Some(resource_id) = positive_reference(
                    npc.resource_id,
                    "资源 ID",
                    &format!("NPC ID {}", npc.id),
                    &mut warnings,
                ) else {
                    continue;
                };
                let linked_resources =
                    self.records(&self.resources, self.resources_by_id.get(&resource_id));
                if linked_resources.is_empty() {
                    warnings.push(format!("资源 ID {resource_id} 未找到"));
                }
                resources.extend(linked_resources);
            }
            npcs.extend(linked_npcs);
        }
        Ok(self.result(
            QueryKind::Target,
            id.to_string(),
            unique_targets(targets),
            unique_npcs(npcs),
            unique_resources(resources),
            warnings,
        ))
    }

    fn query_npc(&self, id: i64) -> Result<QueryResult, ConfigError> {
        let npc_indexes = self
            .npcs_by_id
            .get(&id)
            .ok_or_else(|| ConfigError::NotFound(format!("NPC ID {id} 未找到")))?;
        let mut npcs = self.records(&self.npcs, Some(npc_indexes));
        let mut targets = self.records(&self.targets, self.targets_by_npc_id.get(&id));
        let mut resources = Vec::new();
        let mut warnings = Vec::new();
        if targets.is_empty() {
            warnings.push(format!("没有目标物使用 NPC ID {id}"));
        }
        for npc_index in npc_indexes {
            let npc = &self.npcs[*npc_index];
            let Some(resource_id) = positive_reference(
                npc.resource_id,
                "资源 ID",
                &format!("NPC ID {}", npc.id),
                &mut warnings,
            ) else {
                continue;
            };
            npcs.extend(self.records(&self.npcs, self.npcs_by_resource_id.get(&resource_id)));
            let linked_resources =
                self.records(&self.resources, self.resources_by_id.get(&resource_id));
            if linked_resources.is_empty() {
                warnings.push(format!("资源 ID {resource_id} 未找到"));
            }
            resources.extend(linked_resources);
        }
        Ok(self.result(
            QueryKind::Npc,
            id.to_string(),
            unique_targets(std::mem::take(&mut targets)),
            unique_npcs(npcs),
            unique_resources(resources),
            warnings,
        ))
    }

    fn query_npc_name(&self, value: &str) -> Result<QueryResult, ConfigError> {
        let query = normalize_search_text(value);
        if query.is_empty() {
            return Err(ConfigError::NotFound("NPC 名称不能为空".to_owned()));
        }
        let mut matches = self
            .searchable_npc_names
            .iter()
            .filter(|(name, _)| name.contains(&query))
            .collect::<Vec<_>>();
        matches.sort_by(|(left_name, left_index), (right_name, right_index)| {
            let left = &self.npcs[*left_index];
            let right = &self.npcs[*right_index];
            (
                left_name != &query,
                !left_name.starts_with(&query),
                left_name.chars().count(),
                left.id,
                left.row_number,
            )
                .cmp(&(
                    right_name != &query,
                    !right_name.starts_with(&query),
                    right_name.chars().count(),
                    right.id,
                    right.row_number,
                ))
        });
        if matches.is_empty() {
            return Err(ConfigError::NotFound(format!(
                "NPC 名称“{}”未找到",
                value.trim()
            )));
        }
        let npcs = matches
            .into_iter()
            .map(|(_, index)| self.npcs[*index].clone())
            .collect::<Vec<_>>();
        self.query_npc_records(QueryKind::NpcName, value.trim(), npcs)
    }

    fn query_resource(&self, id: i64) -> Result<QueryResult, ConfigError> {
        let resource_indexes = self
            .resources_by_id
            .get(&id)
            .ok_or_else(|| ConfigError::NotFound(format!("模型资源 ID {id} 未找到")))?;
        let resources = self.records(&self.resources, Some(resource_indexes));
        let npcs = self.records(&self.npcs, self.npcs_by_resource_id.get(&id));
        let mut warnings = Vec::new();
        if npcs.is_empty() {
            warnings.push(format!("没有 NPC 使用资源 ID {id}"));
        }
        let targets = npcs
            .iter()
            .flat_map(|npc| self.records(&self.targets, self.targets_by_npc_id.get(&npc.id)))
            .collect();
        Ok(self.result(
            QueryKind::Resource,
            id.to_string(),
            unique_targets(targets),
            unique_npcs(npcs),
            resources,
            warnings,
        ))
    }

    fn query_npc_records(
        &self,
        kind: QueryKind,
        query: &str,
        npcs: Vec<NpcRecord>,
    ) -> Result<QueryResult, ConfigError> {
        let mut targets = Vec::new();
        let mut resources = Vec::new();
        let mut warnings = Vec::new();
        for npc in &npcs {
            let linked_targets = self.records(&self.targets, self.targets_by_npc_id.get(&npc.id));
            if linked_targets.is_empty() {
                warnings.push(format!("没有目标物使用 NPC ID {}", npc.id));
            }
            targets.extend(linked_targets);
            let Some(resource_id) = positive_reference(
                npc.resource_id,
                "资源 ID",
                &format!("NPC ID {}", npc.id),
                &mut warnings,
            ) else {
                continue;
            };
            let linked_resources =
                self.records(&self.resources, self.resources_by_id.get(&resource_id));
            if linked_resources.is_empty() {
                warnings.push(format!("资源 ID {resource_id} 未找到"));
            }
            resources.extend(linked_resources);
        }
        Ok(self.result(
            kind,
            query.to_owned(),
            unique_targets(targets),
            unique_npcs(npcs),
            unique_resources(resources),
            warnings,
        ))
    }

    fn result(
        &self,
        kind: QueryKind,
        query: String,
        targets: Vec<TargetRecord>,
        npcs: Vec<NpcRecord>,
        resources: Vec<ResourceRecord>,
        warnings: Vec<String>,
    ) -> QueryResult {
        QueryResult {
            kind,
            query,
            targets,
            npcs,
            resources,
            warnings: unique_strings(warnings),
        }
    }

    fn records<T: Clone>(&self, values: &[T], indexes: Option<&Vec<usize>>) -> Vec<T> {
        indexes
            .into_iter()
            .flatten()
            .map(|index| values[*index].clone())
            .collect()
    }
}

fn parse_targets(table: &DoubleHeaderTable) -> Result<Vec<TargetRecord>, ConfigError> {
    let id = table.member_column("MissionPosition.ID")?;
    let target_type = table
        .member_column("MissionPosition.type")
        .or_else(|_| table.label_column("类型"))?;
    let description = table.label_column("描述")?;
    let npc_id = table.member_column("MissionPosition.NPCID")?;
    let position = table.member_column("MissionPosition.Position")?;
    let rotation = table.member_column("MissionPosition.Rotation")?;
    table
        .rows()
        .iter()
        .filter(|row| !table.cell(row, id).is_empty())
        .map(|row| {
            Ok(TargetRecord {
                id: required_integer(table, row, id, "主键")?,
                target_type: table.cell(row, target_type).to_owned(),
                description: table.cell(row, description).to_owned(),
                npc_id: optional_integer(table, row, npc_id, "NPCID")?,
                row_number: row.row_number,
                position: table.cell(row, position).to_owned(),
                rotation: table.cell(row, rotation).to_owned(),
            })
        })
        .collect()
}

fn parse_npcs(table: &DoubleHeaderTable) -> Result<Vec<NpcRecord>, ConfigError> {
    let id = table.member_column("NPC.id")?;
    let note = table.label_column("备注")?;
    let name = table.member_column("NPC.name")?;
    let resource_id = table.member_column("NPC.resource_id")?;
    table
        .rows()
        .iter()
        .filter(|row| !table.cell(row, id).is_empty())
        .map(|row| {
            Ok(NpcRecord {
                id: required_integer(table, row, id, "主键")?,
                note: table.cell(row, note).to_owned(),
                name: table.cell(row, name).to_owned(),
                resource_id: optional_integer(table, row, resource_id, "资源 ID")?,
                row_number: row.row_number,
            })
        })
        .collect()
}

fn parse_resources(table: &DoubleHeaderTable) -> Result<Vec<ResourceRecord>, ConfigError> {
    let id = table.member_column("Model.id")?;
    let configured_path = table.label_prefix_column("配置填写在此列")?;
    let generated_path = table.member_column("Model.path").ok();
    table
        .rows()
        .iter()
        .filter(|row| !table.cell(row, id).is_empty())
        .map(|row| {
            Ok(ResourceRecord {
                id: required_integer(table, row, id, "主键")?,
                configured_path: table.cell(row, configured_path).to_owned(),
                generated_class_path: generated_path
                    .map(|column| table.cell(row, column).to_owned())
                    .unwrap_or_default(),
                row_number: row.row_number,
            })
        })
        .collect()
}

fn parse_query_id(value: &str) -> Result<i64, ConfigError> {
    value
        .trim()
        .parse::<i64>()
        .map_err(|_| ConfigError::NotFound(format!("查询 ID 无效：{value:?}")))
}

fn positive_reference(
    value: Option<i64>,
    label: &str,
    owner: &str,
    warnings: &mut Vec<String>,
) -> Option<i64> {
    match value {
        None => {
            warnings.push(format!("{owner} 未填写 {label}"));
            None
        }
        Some(0) => {
            warnings.push(format!("{owner} 的 {label} 为 0，按未配置处理"));
            None
        }
        Some(value) if value < 0 => {
            warnings.push(format!("{owner} 的 {label} 为 {value}，按特殊值处理"));
            None
        }
        Some(value) => Some(value),
    }
}

fn normalize_search_text(value: &str) -> String {
    value
        .nfkc()
        .flat_map(char::to_lowercase)
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn unique_strings(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

macro_rules! unique_records {
    ($name:ident, $record:ty) => {
        fn $name(values: Vec<$record>) -> Vec<$record> {
            let mut seen = HashSet::new();
            values
                .into_iter()
                .filter(|value| seen.insert((value.id, value.row_number)))
                .collect()
        }
    };
}

unique_records!(unique_targets, TargetRecord);
unique_records!(unique_npcs, NpcRecord);
unique_records!(unique_resources, ResourceRecord);

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEMP_ID: AtomicU64 = AtomicU64::new(0);

    fn temporary_directory() -> PathBuf {
        let suffix = TEMP_ID.fetch_add(1, Ordering::Relaxed);
        let path =
            std::env::temp_dir().join(format!("seria-config-core-{}-{suffix}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn write_common_fixture(directory: &Path) {
        std::fs::write(
            directory.join(TARGET_FILENAME),
            "\u{feff}##&MissionPosition.ID,MissionPosition.type,Description,MissionPosition.NPCID,MissionPosition.Position,MissionPosition.Rotation\nID,类型,描述,NPC,位置,旋转\n1001,1,\"入口, 守卫\",7,\"X=1,Y=2\",R=90\n1001,1,备用守卫,7,X=2,R=0\n",
        ).unwrap();
        std::fs::write(
            directory.join(NPC_FILENAME),
            "##&NPC.id,Note,NPC.name,NPC.resource_id\nID,备注,名称,资源\n7,主记录,Guard,20\n7,重复记录,Guard Variant,20\n",
        ).unwrap();
        std::fs::write(
            directory.join(RESOURCE_FILENAME),
            "##&Model.id,Configured,Model.path\nID,配置填写在此列（手工）,生成路径\n20,/Game/NPC/N7,/Game/Generated/N7\n",
        ).unwrap();
    }

    #[test]
    fn parses_bom_double_headers_quotes_multiline_and_row_numbers() {
        let text = "\u{feff}##&A.id,A.text\nID,描述\n1,\"逗号, 内容\"\n2,\"两行\n内容\"\n";
        let table = DoubleHeaderTable::from_reader("fixture.csv", Cursor::new(text)).unwrap();
        let id = table.member_column("A.id").unwrap();
        let description = table.label_column("描述").unwrap();
        assert_eq!(table.rows().len(), 2);
        assert_eq!(table.rows()[0].row_number, 3);
        assert_eq!(table.rows()[1].row_number, 4);
        assert_eq!(table.cell(&table.rows()[0], id), "1");
        assert_eq!(table.cell(&table.rows()[0], description), "逗号, 内容");
        assert_eq!(table.cell(&table.rows()[1], description), "两行\n内容");
    }

    #[test]
    fn loads_common_tables_and_preserves_duplicate_ids() {
        let directory = temporary_directory();
        write_common_fixture(&directory);
        let database = CommonConfigDatabase::load(&directory).unwrap();
        assert_eq!(database.report().target_count, 2);
        assert_eq!(database.report().npc_count, 2);

        let result = database.query(QueryKind::Npc, "7").unwrap();
        assert_eq!(result.npcs.len(), 2);
        assert_eq!(result.targets.len(), 2);
        assert_eq!(result.resources.len(), 1);

        let named = database.query(QueryKind::NpcName, "guard").unwrap();
        assert_eq!(
            named
                .npcs
                .iter()
                .map(|npc| npc.row_number)
                .collect::<Vec<_>>(),
            vec![3, 4]
        );
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn reports_schema_and_value_errors_with_source_rows() {
        let missing =
            DoubleHeaderTable::from_reader(NPC_FILENAME, Cursor::new("##&NPC.id\nID\nbad\n"))
                .unwrap();
        let error = parse_npcs(&missing).unwrap_err().to_string();
        assert!(error.contains("缺少必需字段：备注"));

        let directory = temporary_directory();
        write_common_fixture(&directory);
        std::fs::write(
            directory.join(NPC_FILENAME),
            "##&NPC.id,Note,NPC.name,NPC.resource_id\nID,备注,名称,资源\nbad,备注,名称,20\n",
        )
        .unwrap();
        let error = CommonConfigDatabase::load(&directory)
            .unwrap_err()
            .to_string();
        assert!(error.contains("第 3 行"));
        assert!(error.contains("\"bad\""));
        std::fs::remove_dir_all(directory).unwrap();
    }
}
