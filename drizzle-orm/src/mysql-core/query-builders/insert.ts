import { MySqlDialect } from '~/mysql-core/dialect';
import { SelectFieldsOrdered } from '~/mysql-core/operations';
import { MySqlRawQueryResult, MySqlSession, PreparedQuery, PreparedQueryConfig } from '~/mysql-core/session';
import { AnyMySqlTable, InferModel } from '~/mysql-core/table';
import { mapUpdateSet } from '~/mysql-core/utils';
import { QueryPromise } from '~/query-promise';
import { Param, Placeholder, Query, SQL, sql, SQLWrapper } from '~/sql';
import { Table } from '~/table';
import { MySqlUpdateSetSource } from './update';
export interface MySqlInsertConfig<TTable extends AnyMySqlTable = AnyMySqlTable> {
	table: TTable;
	values: Record<string, Param | SQL>[];
	onConflict?: SQL;
	returning?: SelectFieldsOrdered;
}

export type AnyMySqlInsertConfig = MySqlInsertConfig<AnyMySqlTable>;

export type MySqlInsertValue<TTable extends AnyMySqlTable> = {
	[Key in keyof InferModel<TTable, 'insert'>]: InferModel<TTable, 'insert'>[Key] | SQL | Placeholder;
};

export class MySqlInsertBuilder<TTable extends AnyMySqlTable> {
	constructor(
		private table: TTable,
		private session: MySqlSession,
		private dialect: MySqlDialect,
	) {}

	values(...values: MySqlInsertValue<TTable>[]): MySqlInsert<TTable> {
		const mappedValues = values.map((entry) => {
			const result: Record<string, Param | SQL> = {};
			const cols = this.table[Table.Symbol.Columns];
			for (const colKey of Object.keys(entry)) {
				const colValue = entry[colKey as keyof typeof entry];
				if (colValue instanceof SQL) {
					result[colKey] = colValue;
				} else {
					result[colKey] = new Param(colValue, cols[colKey]);
				}
			}
			return result;
		});

		return new MySqlInsert(this.table, mappedValues, this.session, this.dialect);
	}
}

export interface MySqlInsert<TTable extends AnyMySqlTable, TReturning = undefined>
	extends QueryPromise<MySqlRawQueryResult>, SQLWrapper
{}
export class MySqlInsert<TTable extends AnyMySqlTable, TReturning = undefined> extends QueryPromise<MySqlRawQueryResult>
	implements SQLWrapper
{
	declare protected $table: TTable;
	declare protected $return: TReturning;

	private config: MySqlInsertConfig<TTable>;

	constructor(
		table: TTable,
		values: MySqlInsertConfig['values'],
		private session: MySqlSession,
		private dialect: MySqlDialect,
	) {
		super();
		this.config = { table, values };
	}

	// onDuplicateDoUpdate(
	// 	target:
	// 		| SQL<GetTableConfig<TTable, 'name'>>
	// 		| ((constraints: GetTableConflictConstraints<TTable>) => Check<GetTableConfig<TTable, 'name'>>),
	// 	set: MySqlUpdateSet<TTable>,
	// ): Pick<this, 'returning' | 'getQuery' | 'execute'> {
	// 	const setSql = this.dialect.buildUpdateSet<GetTableConfig<TTable, 'name'>>(this.config.table, set);

	// 	if (target instanceof SQL) {
	// 		this.config.onConflict = sql<GetTableConfig<TTable, 'name'>>`${target} do update set ${setSql}`;
	// 	} else {
	// 		const targetSql = new Name(target(this.config.table[tableConflictConstraints]).name);
	// 		this.config.onConflict = sql`on constraint ${targetSql} do update set ${setSql}`;
	// 	}
	// 	return this;
	// }

	onDuplicateKeyUpdate(config: {
		// target?: IndexColumn | IndexColumn[];
		set: MySqlUpdateSetSource<TTable>;
	}): this {
		const setSql = this.dialect.buildUpdateSet(this.config.table, mapUpdateSet(this.config.table, config.set));
		this.config.onConflict = sql`update ${setSql}`;
		return this;
	}

	/** @internal */
	getSQL(): SQL {
		return this.dialect.buildInsertQuery(this.config);
	}

	toSQL(): Query {
		return this.dialect.sqlToQuery(this.getSQL());
	}

	private _prepare(name?: string): PreparedQuery<
		PreparedQueryConfig & {
			execute: MySqlRawQueryResult;
		}
	> {
		return this.session.prepareQuery(this.toSQL(), this.config.returning, name);
	}

	prepare(name: string): PreparedQuery<
		PreparedQueryConfig & {
			execute: MySqlRawQueryResult;
		}
	> {
		return this._prepare(name);
	}

	override execute: ReturnType<this['prepare']>['execute'] = (placeholderValues) => {
		return this._prepare().execute(placeholderValues);
	};
}
